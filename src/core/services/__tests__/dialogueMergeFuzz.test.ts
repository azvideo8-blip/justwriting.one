import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { getDeadStoreUpserts, LocalStoreSyncService } from '../LocalStoreSyncService';
import { AIDialogueService } from '../../../features/ai/services/AIDialogueService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';
import { dialogueFingerprint } from '../../storage/dialogueMerge';

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
// Запуск:
//   npx vitest run src/core/services/__tests__/dialogueMergeFuzz.test.ts
//   JW_FUZZ_SEEDS=400 npx vitest run …        (локальный прогон, ~10 минут)
//   JW_FUZZ_SEEDS=6 JW_FUZZ_TRACE=1 …          (разбор одного упадка)
// В CI сидов 50 (JW_FUZZ_SEEDS задаётся в шаге запуска); каждый сид — отдельный
// тест, поэтому таймауты нигде не поднимаются и в отчёте виден номер сида.

const UID = 'u_fuzz';

type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
let onCloudRead: (() => void) | null = null;
let failCas: (() => boolean) | null = null;

vi.mock('../../data', () => ({
  DataProvider: {
    getUserSummaries: async () => [],
    getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
    getLocalStoreRecords: async (_uid: string, store?: string, since?: number) =>
      [...cloud.values()].filter(r => (!store || r.store === store) && (since === undefined || Number(r.payload.updatedAt) > since)),
    getLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      const r = cloud.get(rowKey(store, key));
      return r ? { store, key, payload: r.payload } : null;
    },
    getLocalStoreRecordPages: async (_uid: string, store: string, key: string) => {
      const out = [...cloud.values()].filter(r => r.store === store && r.key.startsWith(`${key}#`));
      if (onCloudRead) { const h = onCloudRead; onCloudRead = null; h(); }
      return out;
    },
    saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
      cloud.set(rowKey(store, key), { store, key, payload });
    },
    saveLocalStoreRecordPages: async (_uid: string, store: string, pages: Array<{ key: string; payload: Record<string, unknown> }>) => {
      for (const p of pages) cloud.set(rowKey(store, p.key), { store, key: p.key, payload: p.payload });
    },
    saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      if (failCas && failCas()) throw new Error('network');
      const cur = cloud.get(rowKey(store, key));
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      cloud.set(rowKey(store, key), { store, key, payload });
      return true;
    },
    deleteLocalStorePagedRecords: async (_uid: string, store: string, key: string) => {
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
    },
    deleteLocalStoreStalePages: async (_uid: string, store: string, key: string, keepStamp: number, keepNonce?: string) => {
      const keep = keepNonce ? `${key}#${keepStamp}#${keepNonce}#` : `${key}#${keepStamp}#`;
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`) && !r.key.startsWith(keep)) cloud.delete(k);
    },
    deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      cloud.delete(rowKey(store, key));
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
    },
  },
}));
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
const cloudKeysOf = (id: string) => [...cloud.values()].filter(r => r.key === id || r.key.startsWith(`${id}#`)).map(r => r.key);

/** 0.9.28 переложил облачную копию на страницы `key#N` без строки `key`. */
async function legacyRepage(id: string): Promise<void> {
  const rec = await local(id);
  if (!rec) return;
  const json = JSON.stringify(rec);
  const n = 2;
  for (const [k, r] of [...cloud]) if (r.store === 'aiDialogues' && (r.key === id || r.key.startsWith(id + '#'))) cloud.delete(k);
  const size = Math.ceil(json.length / n);
  for (let i = 0; i < n; i++) {
    const key = id + '#' + i;
    cloud.set(rowKey('aiDialogues', key), {
      store: 'aiDialogues',
      key,
      payload: { data: json.slice(i * size, (i + 1) * size), updatedAt: rec.updatedAt, page: i, totalPages: n },
    });
  }
}

async function flushDev(): Promise<{ failed: number; skippedOversized: number }> {
  const r = await LocalStoreSyncService.flushPending(true);
  if (LSS.timer !== null) { clearTimeout(LSS.timer); LSS.timer = null; }
  return r;
}

async function pull(dev: Device, full: boolean): Promise<{ failed: number }> {
  const now = Date.now();
  const r = await restoreAIDataFromCloud(UID, full || !dev.lastPull ? undefined : { sinceMs: dev.lastPull - 30 * 60 * 1000 });
  dev.lastPull = now;
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
const BLOB = 'ж'.repeat(95_000);

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
  for (const dv of devs.slice(1)) { switchTo(dv); await pull(dv, true); }
  switchTo(devs[0]!);
  // Гарантируем постраничную ветку в каждом сиде: без неё тест тихо превращается
  // в перебор однострочных диалогов.
  switchTo(devs[0]!);
  await AIDialogueService.appendMessage(id, `Вопрос ${BLOB}`, `Ответ ${BLOB}`, BLOB);
  await flushDev();
  // Покрытием считается ANY постраничная выгрузка сида: размер первой записи зависит
  // от того, что уже лежит в диалоге, и требовать её в два куска на первом же
  // шаге — значит ловить стенд, а не продукт.
  let pagedSeen = cloudKeysOf(id).some(k => k.includes('#'));
  const created = new Set<string>((await local(id))!.messages.map(m => m.id!));
  const deleted = new Set<string>();
  failCas = FAILP !== 0 ? () => r() < FAILP : null;
  let dialogueDeleted = false;
  let n = 0;
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
        // M-1: облачная копия без манифеста — её переложил старый клиент (или
        // старый таб стёр строку `key`, оставив страницы). Выгрузка обязана
        // вернуться в эту точку и пройти CAS по состоянию самой строки `key`.
        await legacyRepage(id);
      } else if (x < 0.53 + DELP + LEGP + 0.02) {
        if (cloudKeysOf(id).some(k => k.includes('#'))) cloud.delete(rowKey('aiDialogues', id));
      } else if (x < 0.78) {
        await flushDev();
      } else {
        await pull(dev, r() < 0.2);
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
    for (const m of after?.messages ?? []) if (m.id && !before?.messages.some(b => b.id === m.id)) created.add(m.id);
  }
  failCas = null;
  clock += 3_600_000;
  for (let round = 0; round < 4; round++) for (const dv of devs) { switchTo(dv); await flushDev(); await pull(dv, true); await flushDev(); }

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
  if (!pagedSeen) {
    const bytes = new TextEncoder().encode(JSON.stringify(await local(id))).length;
    failures.push(`за весь сид ни одна выгрузка не стала постраничной: размер записи ${bytes} Б, порог 512000 Б, ключи ${JSON.stringify(cloudKeysOf(id).map(k => k.slice(id.length)))}`);
  }
  if (oversizedSeen > 0) failures.push(`запись переросла лимит выгрузки (${oversizedSeen} раз) — хода не уехали по Дизайнy, тест не покрывает эту ветку`);
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
