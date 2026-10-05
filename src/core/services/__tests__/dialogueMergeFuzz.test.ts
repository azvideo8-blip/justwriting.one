import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { getDeadStoreUpserts, LocalStoreSyncService } from '../LocalStoreSyncService';
import { AIDialogueService } from '../../../features/ai/services/AIDialogueService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';
import { nextPullCursor } from '../../../features/ai/services/pullCursor';
import { dialogueFingerprint } from '../../storage/dialogueMerge';
import { planDialogue, type DialogueHead, type CloudSegmentRow } from '../dialogueSegments';

// Сеть-фаззинг слияния диалогов (главная страховка Track M). Порт стенда
// merge-repro/rv3fuzz.test.ts из justwriting-docs — с НАСТОЯЩИМИ порогами
// постраничной выгрузки (500 КБ / 8 страниц): диалог раздувается правдами, а не
// подменой констант, так что проверятся та же ветка, что и на проде.
//
// Три устройства, расхождение часов ±SKEW, перемешанные append/delete/replace/
// variant/rename/delete-dialog/flush/pull; часть условных записей падает по
// «сети» (FAILP). После оседания все три копии обязаны сойтись в один снимок,
// ни один живой ход не теряется, удалённый не воскресает, дублей нет.
//
// Что смоделировано, кроме перемешанных операций:
//   · порядок строк у провайдера — (store, key), как у PostgREST. С вставочным
//     порядком R-1 (осиротевшее окно как «единственная строка диалога») не виден
//     вовсе: пересозданная строка `key` попадала бы в конец списка сама;
//   · триггер 0037 — серверная отметка базовой строки (JW_FUZZ_NOSTAMP=1 её снимает);
//   · сбои не только до записи, но и ПОСЛЕ («ответ потерян») и на пачке сегментов;
//   · инварианты конца: ни окна без head, ни head без своего окна, ни страниц
//     рядом с head, и забор не обязан срезать живой ход.
//
// Запуск:
//   npx vitest run src/core/services/__tests__/dialogueMergeFuzz.test.ts
//   JW_FUZZ_SEEDS=400 npx vitest run …        (локальный прогон, ~50 с на 8 ядрах)
//   JW_FUZZ_SEEDS=6 JW_FUZZ_TRACE=1 …          (разбор одного упадка)
// В CI сидов 50 — это значение по умолчанию: `test:ci` (`vitest run --coverage`)
// запускается без `JW_FUZZ_SEEDS`, отдельного шага с переменной в workflow нет.
// Каждый сид — отдельный тест, поэтому таймауты нигде не поднимаются и в отчёте виден номер сида.

const UID = 'u_fuzz';

type Row = { store: string; key: string; payload: Record<string, unknown>; stamped_at: number };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
let onCloudRead: (() => void) | null = null;
let onBeforeDeletePaged: ((key: string) => Promise<void>) | null = null;
let failCas: (() => boolean) | null = null;
// Сбой «сети»: 'net' — бросок ДО записи, 'lost' — запись легла, а ответ потерян.
let failMode: (() => 'ok' | 'net' | 'lost') = () => 'ok';
let failPages: (() => 'ok' | 'net' | 'lost') = () => 'ok';
// Триггер 0037 на базовой строке диалога: серверные часы — общие `clock` без
// перекоса устройства, отметки строго возрастают. JW_FUZZ_NOSTAMP=1 выключает его
// и смотрит раскатку «сначала клиент, миграции ещё нет».
let lastStamp = 0;
const STAMP = process.env.JW_FUZZ_NOSTAMP ? false : true;
function stampRow(store: string, key: string, payload: Record<string, unknown>): Record<string, unknown> {
  if (!STAMP) return payload;
  if (store === 'aiDialogues' && !key.includes('#') && !key.includes('@') && typeof payload.updatedAt === 'number') {
    lastStamp = Math.max(clock, lastStamp + 1);
    return { ...payload, updatedAt: lastStamp };
  }
  return payload;
}
function setCloud(store: string, key: string, payload: Record<string, unknown>, stamped_at = clock): void {
  cloud.set(rowKey(store, key), { store, key, payload, stamped_at });
}
const sortedRows = (rows: Row[]) => rows.sort((a, b) => a.store.localeCompare(b.store) || a.key.localeCompare(b.key));

vi.mock('../../data', async () => {
  const actual = await vi.importActual<typeof import('../../data')>('../../data');
  return {
    ...actual,
    DataProvider: {
      getLocalStoreRecordsByKeyPrefix: async (_uid: string, store: string, prefix: string) =>
        [...cloud.values()]
          .filter(r => r.store === store && r.key.startsWith(prefix))
          .map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>)),
      deleteLocalStoreRecordsByKeys: async (_uid: string, store: string, keys: string[]) => {
        const f = failMode();
        if (f === 'net') throw new Error('network: delete failed');
        for (const k of keys) cloud.delete(`${store}:${k}`);
        if (f === 'lost') throw new Error('network: delete response lost');
      },
      getUserSummaries: async () => [],
      getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
      getLocalStoreRecords: async (_uid: string, store?: string, since?: number) =>
        sortedRows([...cloud.values()].filter(r => (!store || r.store === store) && (since === undefined || Number(r.payload.updatedAt) > since)))
          .map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>)),
      getLocalStoreRecord: async (_uid: string, store: string, key: string) => {
        const r = cloud.get(rowKey(store, key));
        return r ? actual.rowToLocalStoreRecord(r as Record<string, unknown>) : null;
      },
      getLocalStoreRecordPages: async (_uid: string, store: string, key: string) => {
        const out = [...cloud.values()].filter(r => r.store === store && r.key.startsWith(`${key}#`));
        if (onCloudRead) { const h = onCloudRead; onCloudRead = null; h(); }
        return out.map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>));
      },
    saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
      const f = failMode();
      if (f === 'net') throw new Error('network');
      setCloud(store, key, stampRow(store, key, payload), clock);
      if (f === 'lost') throw new Error('network: response lost');
    },
    saveLocalStoreRecordPages: async (_uid: string, store: string, pages: Array<{ key: string; payload: Record<string, unknown> }>) => {
      const f = failPages();
      if (f === 'net') throw new Error('network: pages');
      for (const p of pages) {
        setCloud(store, p.key, stampRow(store, p.key, p.payload), clock);
      }
      if (f === 'lost') throw new Error('network: pages response lost');
    },
    saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      if (failCas && failCas()) throw new Error('network');
      const f = failMode();
      if (f === 'net') throw new Error('network');
      const cur = cloud.get(rowKey(store, key));
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      setCloud(store, key, stampRow(store, key, payload), clock);
      if (f === 'lost') throw new Error('network: response lost');
      return true;
    },
    deleteLocalStorePagedRecords: async (_uid: string, store: string, key: string) => {
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
      if (store === 'aiDialogues' && onBeforeDeletePaged) {
        await onBeforeDeletePaged(key);
      }
    },
    deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      cloud.delete(rowKey(store, key));
      // Дочерние строки записи: страницы `key#…` (прошлые форматы) и сегменты
      // `key@seg…` (M-5). Провайдер сносит и те, и другие.
      for (const [k, r] of cloud) if (r.store === store && (r.key.startsWith(`${key}#`) || r.key.startsWith(`${key}@`))) cloud.delete(k);
    },
  },
};
});
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => false }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../shared/errors/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../features/ai/utils/embeddingIndexer', () => ({ sha256Hex: async (s: string) => s }));
vi.mock('../../../features/ai/services/AIService', () => ({ AIService: { chat: vi.fn(), embed: vi.fn(), extractChatMemory: vi.fn() } }));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }),
  getCurrentUserId: () => UID,
}));

class Device {
  readonly factory = new IDBFactory();
  readonly storage = new Map<string, string>();
  lastPull = 0;
  constructor(readonly name: string, readonly skew: number) {}
}

const LSS = LocalStoreSyncService as unknown as { pending: Map<string, unknown>; timer: ReturnType<typeof setTimeout> | null; deleteGen: Map<string, number> };
let currentDevice: Device | null = null;
let clock = 0;

function switchTo(dev: Device): void {
  if (LSS.timer !== null) { clearTimeout(LSS.timer); LSS.timer = null; }
  LSS.pending.clear();
  if (currentDevice === dev) { vi.setSystemTime(clock + dev.skew); return; }
  if (currentDevice) {
    currentDevice.storage.clear();
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; currentDevice.storage.set(k, localStorage.getItem(k)!); }
  }
  localStorage.clear();
  for (const [k, v] of dev.storage) localStorage.setItem(k, v);
  resetDbInstance();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = dev.factory;
  currentDevice = dev;
  vi.setSystemTime(clock + dev.skew);
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const local = async (id: string): Promise<AIDialogue | undefined> => (await getLocalDb()).get('aiDialogues', id);
// Строки диалога: head (`id`), его сегменты (`id@seg…`) и страницы прежних
// форматов (`id#…`).
const cloudKeysOf = (id: string) => [...cloud.values()]
  .filter(r => r.key === id || r.key.startsWith(`${id}#`) || r.key.startsWith(`${id}@seg`))
  .map(r => r.key);



async function flushDev(): Promise<{ failed: number; skippedOversized: number }> {
  const r = await LocalStoreSyncService.flushPending(true);
  if (LSS.timer !== null) { clearTimeout(LSS.timer); LSS.timer = null; }
  return r;
}

async function pull(dev: Device, full: boolean): Promise<{ failed: number }> {
  // Курсор — тот же, что у фона: та же формула, что в hook'е, а не её копия.
  const startedAt = Date.now();
  const r = await restoreAIDataFromCloud(UID, full || !dev.lastPull ? undefined : { sinceMs: dev.lastPull - 30 * 60 * 1000 });
  dev.lastPull = nextPullCursor(startedAt, dev.lastPull || startedAt - 24 * 3600_000, r.maxUpdatedAt);
  if (LSS.timer !== null) { clearTimeout(LSS.timer); LSS.timer = null; }
  return r;
}

const SEEDS = Number(process.env.JW_FUZZ_SEEDS ?? 50);
const SKEW = Number(process.env.JW_FUZZ_SKEW ?? 24 * 60 * 60 * 1000);
const FAILP = Number(process.env.JW_FUZZ_FAILP ?? 0.15);
const DELP = Number(process.env.JW_FUZZ_DELP ?? 0.02);
const LEGP = Number(process.env.JW_FUZZ_LEGP ?? 0.04);
// Часы квантуются (по умолчанию минуту), иначе отметки двух устройств почти никогда
// не совпадают, а collide страниц разных попыток одной отметки — это ровно M-2.
const CLOCK_STEP = Number(process.env.JW_FUZZ_CLOCK_STEP ?? 60_000);
const TRACE = !!process.env.JW_FUZZ_TRACE;
// Кусок текста, из-за которого диалог переваливает за порог страницы (500 КБ).
// appendMessage режет реплику и рассуждение по 100 000 знаков, поэтому кусок
// чуть меньше: три куска (вопрос, ответ, рассуждение) ≈ 570 КБ в UTF-8 — за
// порогом страницы.
const BLOB = 'ж'.repeat(Number(process.env.JW_FUZZ_BLOB ?? 95_000));
const LOSTP = Number(process.env.JW_FUZZ_LOSTP ?? 0.05);
const PAGEFAILP = Number(process.env.JW_FUZZ_PAGEFAILP ?? 0.15);

async function runSeed(seed: number): Promise<string[]> {
  const failures: string[] = [];
  const trace: string[] = [];
  let oversizedSeen = 0;
  cloud.clear(); currentDevice = null; localStorage.clear(); LSS.deleteGen.clear();
  // Дебаунс-таймер LocalStoreSyncService — настоящий (fake только Date). Если
  // он доживает до следующего сида, flush срабатывает над чужой IndexedDB и
  // очередью, и «потерянный ход» оказывается течкой стенда, а не продукта.
  if (LSS.timer !== null) { clearTimeout(LSS.timer); LSS.timer = null; }
  LSS.pending.clear();
  const r = rng(seed * 7919);
  clock = Date.parse('2026-10-02T09:00:00Z');
  const devs = [new Device('A', 0), new Device('B', Math.round((r() * 2 - 1) * SKEW)), new Device('C', Math.round((r() * 2 - 1) * SKEW))];
  switchTo(devs[0]!);
  const d = await AIDialogueService.create({
    title: 'T', personaId: 'p', personaName: 'P', personaEmoji: '🎯',
    messages: [{ role: 'user', content: 'q0' }, { role: 'assistant', content: 'a0' }],
  });
  const id = d.id;
  oversizedSeen += (await flushDev()).skippedOversized;
  const devDialogues = new Map<Device, AIDialogue>();
  for (const dv of devs.slice(1)) {
    switchTo(dv);
    await pull(dv, true);
    const cur = await local(id);
    if (cur) devDialogues.set(dv, cur);
  }
  switchTo(devs[0]!);
  // Гарантируем постраничную ветку в каждом сиде: без неё тест тихо превращается
  // в перебор однострочных диалогов.
  switchTo(devs[0]!);
  await AIDialogueService.appendMessage(id, `Вопрос ${BLOB}`, `Ответ ${BLOB}`, BLOB);
  await flushDev();
  const d0 = await local(id); if (d0) devDialogues.set(devs[0]!, d0);
  // Покрытием считается ANY выгрузка дальше одной строки сида (страницы `key#…`
  // или сегменты `key@seg…`): размер первой записи зависит от того, что уже лежит
  // в диалоге, и требовать её в два куска на первом же шаге — значит ловить
  // стенд, а не продукт.
  let splitSeen = cloudKeysOf(id).length > 1;
  const created = new Set<string>((await local(id))!.messages.map(m => m.id!));
  const deleted = new Set<string>();
  failCas = FAILP !== 0 ? () => r() < FAILP : null;
  failMode = () => { const x = r(); return x < LOSTP ? 'lost' : 'ok'; };
  failPages = () => { const x = r(); return x < PAGEFAILP ? 'net' : x < PAGEFAILP + LOSTP ? 'lost' : 'ok'; };

  // T-4: интерливинг — пока победитель single-row CAS сносит старые страницы в
  // deleteLocalStorePagedRecords, другое устройство успевает выгрузить свой head,
  // усыновив осиротевшее окно.
  onBeforeDeletePaged = async (key: string) => {
    const other = devs.find(d => d !== currentDevice && devDialogues.has(d) && !devDialogues.get(d)!.deletedAt && devDialogues.get(d)!.messages.length > 0);
    if (!other) return;
    const localD = devDialogues.get(other)!;
    const segRows = [...cloud.values()].filter(row => row.store === 'aiDialogues' && row.key.startsWith(key + '@seg'));
    if (segRows.length === 0) return;
    const cloudSegs: CloudSegmentRow[] = segRows.map(s => ({
      key: s.key,
      firstAt: Number(s.payload.firstAt) || 0,
      updatedAt: Number(s.payload.updatedAt) || 0,
      messages: typeof s.payload.messages === 'string' ? s.payload.messages : null,
      stampedAt: s.stamped_at,
    }));
    const curHeadRow = cloud.get(rowKey('aiDialogues', key));
    const curHead = curHeadRow?.payload.head === true ? (curHeadRow.payload as unknown as DialogueHead) : undefined;
    const plan = planDialogue(localD, { head: curHead, segments: cloudSegs });
    const segKeySet = new Set(segRows.map(s => s.key));
    const adopted = plan.head.segments.some(s => segKeySet.has(s.key));
    if (!adopted) return;
    for (const s of plan.toWrite) {
      setCloud('aiDialogues', s.key, { seg: true, headKey: key, firstAt: s.firstAt, lastAt: s.lastAt, updatedAt: s.updatedAt, messages: JSON.stringify(s.messages) }, clock);
    }
    setCloud('aiDialogues', key, stampRow('aiDialogues', key, { ...plan.head }), clock);
  };

  let dialogueDeleted = false;
  let n = 0;

  /** 0.9.28 переложил облачную копию на страницы `key#N` без строки `key`. */
  const legacyRepage = async (id: string): Promise<void> => {
    const rec = await local(id);
    if (!rec) return;
    const json = JSON.stringify(rec);
    const numPages = 2;
    for (const [k, r] of [...cloud]) if (r.store === 'aiDialogues' && (r.key === id || r.key.startsWith(id + '#'))) cloud.delete(k);
    const size = Math.ceil(json.length / numPages);
    for (let i = 0; i < numPages; i++) {
      const key = id + '#' + i;
      cloud.set(rowKey('aiDialogues', key), {
        store: 'aiDialogues',
        key,
        payload: { data: json.slice(i * size, (i + 1) * size), updatedAt: rec.updatedAt, page: i, totalPages: numPages },
        stamped_at: clock,
      });
    }
  };

  /** 0.9.29 слепая выгрузка всего диалога одной строкой — затирает head, оставляет сегменты. */
  const legacySingleUpsert = async (id: string): Promise<void> => {
    const rec = await local(id);
    if (!rec) return;
    const json = JSON.stringify(rec);
    for (const [k, r] of [...cloud]) if (r.store === 'aiDialogues' && r.key.startsWith(id + '#')) cloud.delete(k);
    cloud.set(rowKey('aiDialogues', id), {
      store: 'aiDialogues',
      key: id,
      payload: stampRow('aiDialogues', id, { data: json, updatedAt: rec.updatedAt }),
      stamped_at: clock,
    });
  };

  /** 0.9.29 cleanupEmpty сносит строку в облаке, ТОЛЬКО если в data пустые messages (head не трогает). */
  const legacyCleanupEmpty = (id: string): void => {
    const r = cloud.get(rowKey('aiDialogues', id));
    if (!r || typeof r.payload.data !== 'string') return;
    try {
      const p = JSON.parse(r.payload.data) as { messages?: unknown[] };
      if (!p.messages || p.messages.length === 0) {
        cloud.delete(rowKey('aiDialogues', id));
      }
    } catch {
      // ignore
    }
  };

  const steps = 25 + Math.floor(r() * 20);
  for (let step = 0; step < steps; step++) {
    clock = Math.floor((clock + Math.floor(r() * 90_000)) / CLOCK_STEP) * CLOCK_STEP;
    const dev = devs[Math.floor(r() * 3)]!;
    switchTo(dev);
    const before = await local(id);
    const x = r();
    try {
      if (x < 0.25) {
        // Часть правок делает диалог постраничным — это та ветка, где три раунда
        // подряд находили баги (манифест, CAS, collide ключей).
        const big = r() < 0.35 ? ` ${BLOB}` : '';
        await AIDialogueService.appendMessage(id, `u${seed}_${++n}${big}`, `a${seed}_${n}${big}`);
      } else if (x < 0.35 && before && !before.deletedAt && before.messages.length) {
        const m = before.messages[Math.floor(r() * before.messages.length)]!;
        if (m.id) { await AIDialogueService.deleteMessage(id, m.id); deleted.add(m.id); }
      } else if (x < 0.43 && before && !before.deletedAt) {
        const users = before.messages.filter(m => m.role === 'user' && m.type !== 'system' && m.id !== undefined);
        const u = users[Math.floor(r() * users.length)];
        if (u) await AIDialogueService.replaceLastTurn(id, u.id!, u.content, `regen${seed}_${++n}`);
      } else if (x < 0.49 && before && !before.deletedAt) {
        const withV = before.messages.filter(m => m.variants !== undefined && m.variants.length > 1 && m.id !== undefined);
        const m = withV[Math.floor(r() * withV.length)];
        if (m) await AIDialogueService.switchVariant(id, m.id!, Math.floor(r() * m.variants!.length));
      } else if (x < 0.53) {
        await AIDialogueService.updateTitle(id, `t${++n}`);
      } else if (x < 0.53 + DELP) {
        await AIDialogueService.delete(id);
        if (before && !before.deletedAt) dialogueDeleted = true;
      } else if (x < 0.53 + DELP + LEGP) {
        // Старый клиент: перекладывает на страницы, слепо пишет одну строку или чистит пустые диалоги
        const op = r();
        if (op < 0.25) {
          await legacyRepage(id);
        } else if (op < 0.50) {
          await legacySingleUpsert(id);
        } else if (op < 0.75) {
          const rec = await local(id);
          if (rec && !rec.deletedAt) {
            dialogueDeleted = true;
            for (const m of rec.messages) if (m.id) deleted.add(m.id);
            const tomb = { ...rec, deletedAt: clock, messages: [] };
            for (const [k, r] of [...cloud]) if (r.store === 'aiDialogues' && r.key.startsWith(id + '#')) cloud.delete(k);
            cloud.set(rowKey('aiDialogues', id), {
              store: 'aiDialogues',
              key: id,
              payload: stampRow('aiDialogues', id, { data: JSON.stringify(tomb), updatedAt: clock }),
              stamped_at: clock,
            });
          }
        } else {
          legacyCleanupEmpty(id);
        }
      } else if (x < 0.53 + DELP + LEGP + 0.02) {
        // Строка-указатель стёрта, а дочерние строки живы: под paging это был
        // «старый таб снёс манифест», под M-5 — head удалён при целых сегментах.
        if (cloudKeysOf(id).length > 1) cloud.delete(rowKey('aiDialogues', id));
      } else if (x < 0.78) {
        await flushDev();
      } else {
        const pr = await pull(dev, r() < 0.2);
        if (TRACE) trace.push(`pull on ${dev.name} failed=${pr.failed} local=${(await local(id))?.messages.length}`);
        const after = await local(id);
        if (before && !before.deletedAt && after && !after.deletedAt) {
          const ids = new Set(after.messages.map(m => m.id));
          for (const m of before.messages) if (m.id && !deleted.has(m.id) && !ids.has(m.id)) failures.push(`pull на ${dev.name} убрал живой ход ${m.id.slice(0, 8)} (укороченная копия принята как полная)`);
        }
      }
    } catch (e) {
      failures.push(`op threw ${String(e)}`);
    }
    // Дебаунс-таймер выгрузки — настоящий (fake только Date): если он доживает
    // до следующей операции, flushPending выполняется сам, в момент, зависящий от
    // стенного времени, и один и тот же набор сидов даёт разный результат. В
    // стенде выгружаются только те места, где flush вызван явно.
    if (LSS.timer !== null) { clearTimeout(LSS.timer); LSS.timer = null; }
    if (TRACE) {
      const after = await local(id);
      trace.push(`${step} ${dev.name} x=${x.toFixed(3)} local=${before ? (before.deletedAt ? 'TOMB' : before.messages.length) : '-'} -> ${after ? (after.deletedAt ? 'TOMB' : after.messages.length) : '-'} cloud=${JSON.stringify(cloudKeysOf(id).map(k => k.slice(id.length)))}`);
    }
    const after = await local(id);
    if (after) devDialogues.set(dev, after);
    for (const m of after?.messages ?? []) if (m.id && !before?.messages.some(b => b.id === m.id)) created.add(m.id);
  }
  failCas = null; failMode = () => 'ok'; failPages = () => 'ok'; onBeforeDeletePaged = null;
  clock += 3_600_000;
  for (let round = 0; round < 4; round++) {
    clock += 15 * 60_000;
    legacyCleanupEmpty(id);
    for (const dv of devs) {
      switchTo(dv);
      await pull(dv, true);
      LocalStoreSyncService.scheduleStoreSync('aiDialogues', id);
      await flushDev();
    }
  }

  const finals: Array<AIDialogue | undefined> = [];
  for (const dv of devs) {
    switchTo(dv);
    finals.push(await local(id));
    const listed = (await AIDialogueService.list({ includeArchived: true })).map(z => z.id);
    if (dialogueDeleted && listed.includes(id)) failures.push(`${dv.name}: удалённый диалог в списке`);
    if (!dialogueDeleted && !listed.includes(id)) failures.push(`${dv.name}: живой диалог пропал из списка`);
  }
  const fps = finals.map(f => (f ? dialogueFingerprint(f) : 'none'));
  if (new Set(fps).size !== 1) {
    failures.push('копии не сошлись');
    for (const [i, dv] of devs.entries()) {
      switchTo(dv);
      failures.push(`  ${dv.name} n=${finals[i]?.messages.length} upd=${finals[i]?.updatedAt} tomb=${JSON.stringify(finals[i]?.deletedMessages?.map(t => t.id.slice(0, 6)))} ids=${JSON.stringify(finals[i]?.messages.map(m => m.id!.slice(0, 6)))} dead=${JSON.stringify(getDeadStoreUpserts(UID))}`);
    }
    failures.push(`  cloud=${JSON.stringify(cloudKeysOf(id).map(k => k.slice(id.length)))}`);
  }
  if ((await LocalStoreSyncService.flushPending(true)).failed) failures.push('финальная выгрузка упала');
  {
    const headRow = cloud.get(rowKey('aiDialogues', id));
    const segKeys = cloudKeysOf(id).filter(k => k.includes('@seg'));
    const pageKeys = cloudKeysOf(id).filter(k => k.includes('#'));
    if (headRow?.payload.head === true) {
      const named = new Set(((headRow.payload.segments as Array<{ key: string }>) ?? []).map(s => s.key));
      const orphans = segKeys.filter(k => !named.has(k));
      if (orphans.length) failures.push(`осиротевшие окна: ${orphans.length}`);
      const missing = [...named].filter(k => !cloud.has(rowKey('aiDialogues', k)));
      if (missing.length) failures.push(`head называет отсутствующие окна: ${missing.length}`);
      if (pageKeys.length) failures.push(`страницы прежнего формата рядом с head: ${pageKeys.length}`);
    } else if (segKeys.length) {
      failures.push(`окна без head: ${segKeys.length}`);
    }
  }
  if (!splitSeen) {
    const bytes = new TextEncoder().encode(JSON.stringify(await local(id))).length;
    failures.push(`за весь сид ни одна выгрузка не вышла за одну строку (ни страниц, ни сегментов): размер записи ${bytes} Б, порог 512000 Б, ключи ${JSON.stringify(cloudKeysOf(id).map(k => k.slice(id.length)))}`);
  }
  if (oversizedSeen > 0) failures.push(`запись переросла лимит выгрузки (${oversizedSeen} раз) — хода не уехали по дизайну, тест не покрывает эту ветку`);
  if (!dialogueDeleted) {
    const ids = finals[0]!.messages.map(m => m.id!);
    if (new Set(ids).size !== ids.length) failures.push('дубли id');
    const contents = finals[0]!.messages.filter(m => m.type !== 'system').map(m => m.content);
    if (new Set(contents).size !== contents.length) failures.push(`дубли содержимого ${JSON.stringify(contents.map(c => c.slice(0, 12)))}`);
    for (const c of created) if (!deleted.has(c) && !ids.includes(c)) failures.push(`потерян живой ход ${c.slice(0, 8)}`);
    for (const dd of deleted) if (ids.includes(dd)) failures.push(`воскрес удалённый ${dd.slice(0, 8)}`);
  }
  if (LSS.timer !== null) { clearTimeout(LSS.timer); LSS.timer = null; }
  LSS.pending.clear();
  if (TRACE && failures.length > 0) console.log(`\n--- trace сида ${seed} ---\n${trace.join('\n')}`);
  return failures;
}

describe(`fuzz слияния диалогов: 3 устройства × ${SEEDS} сидов, FAILP=${FAILP}, SKEW=${SKEW} мс`, () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Один сид = один тест: номер сида виден в отчёте, и поднимать таймауты не нужно.
  const only = process.env.JW_FUZZ_ONLY?.split(',').map(x => Number(x.trim())).filter(n => Number.isFinite(n));
  const seeds = only && only.length ? only : Array.from({ length: SEEDS }, (_, i) => i + 1);
  it.each(seeds)('сид %i', async (seed) => {
    const failures = await runSeed(seed);
    expect(failures, `сид ${seed}`).toEqual([]);
  });
});
