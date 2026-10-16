import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { AIDialogueService } from '../../../features/ai/services/AIDialogueService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { segmentPrefixOf } from '../dialogueSegments';
import { oldClientWrites } from './helpers/oldClientRestore029';

// M-5: диалог крупнее одной строки живёт в облаке head'ом (строка `key`) и
// append-only сегментами (`key@seg…`) вместо страниц одной строки с манифестом.
// Здесь проверяется именно ВЫГРУЗКА: настоящим путём (LocalStoreSyncService +
// restoreAIDataFromCloud), по-настоящему большим диалогом (диалог раздувается
// текстом, пороги 500 КБ / 8 строк / 400 КБ не подменяются) и на облаке с теми
// же операциями, что у провайдера.
//
// Красный на базе (8eeb52cf + M-1…M-4): там этот путь пишет страницы
// `key#<stamp>#<nonce>#p<i>` и манифест, а head’а и сегментов нет вовсе.

const UID = 'u_m5';

type Row = { store: string; key: string; payload: Record<string, unknown>; stamped_at?: number };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;

/** Порядок обращений к облаку — по нему видно, что head подписан ПОСЛЕ тела. */
const ops: string[] = [];
let casResult = true;
let casThrows = false;
let deleteKeysCalls: string[][] = [];

vi.mock('../../data', () => ({
  DataProvider: {
    getLocalStoreRecordsByKeyPrefix: async (_uid: string, store: string, prefix: string) =>
      [...cloud.values()]
        .filter(r => r.store === store && r.key.startsWith(prefix))
        .map(r => ({ store: r.store, key: r.key, payload: r.payload, stamped_at: r.stamped_at })),
    deleteLocalStoreRecordsByKeys: async (_uid: string, store: string, keys: string[]) => {
      ops.push(`deleteKeys:${keys.length}`);
      deleteKeysCalls.push(keys);
      for (const k of keys) cloud.delete(rowKey(store, k));
    },
    getUserSummaries: async () => [],
    getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
    getLocalStoreRecords: async (_uid: string, store?: string, since?: number) =>
      [...cloud.values()]
        .filter(r => (!store || r.store === store) && (since === undefined || Number(r.payload.updatedAt) > since))
        .map(r => ({ store: r.store, key: r.key, payload: r.payload, stamped_at: r.stamped_at })),
    getLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      const r = cloud.get(rowKey(store, key));
      return r ? { store, key, payload: r.payload, stamped_at: r.stamped_at } : null;
    },
    getLocalStoreRecordPages: async (_uid: string, store: string, key: string) =>
      [...cloud.values()].filter(r => r.store === store && r.key.startsWith(`${key}#`)),
    saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
      ops.push(`save:${key}`);
      cloud.set(rowKey(store, key), { store, key, payload, stamped_at: Date.now() });
    },
    saveLocalStoreRecordPages: async (_uid: string, store: string, pages: Array<{ key: string; payload: Record<string, unknown> }>) => {
      ops.push(`pages:${pages.length}`);
      for (const p of pages) cloud.set(rowKey(store, p.key), { store, key: p.key, payload: p.payload, stamped_at: Date.now() });
    },
    saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      ops.push(`cas:${key}`);
      // Сбой «сети» ПОСЛЕ того, как тело уже легло: ровно то состояние, из
      // которого повтор обязан принять готовые окна, а не писать их заново.
      if (casThrows) throw new Error('network');
      if (!casResult) return false;
      const cur = cloud.get(rowKey(store, key));
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      cloud.set(rowKey(store, key), { store, key, payload, stamped_at: Date.now() });
      return true;
    },
    deleteLocalStorePagedRecords: async (_uid: string, store: string, key: string) => {
      ops.push('deletePaged');
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
    },
    deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => {
      cloud.delete(rowKey(store, key));
      for (const [k, r] of cloud) if (r.store === store && (r.key.startsWith(`${key}#`) || r.key.startsWith(`${key}@`))) cloud.delete(k);
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
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }),
  getCurrentUserId: () => UID,
}));

class Device {
  readonly factory = new IDBFactory();
  readonly storage = new Map<string, string>();
}

let currentDevice: Device | null = null;

function switchTo(dev: Device): void {
  if (currentDevice === dev) return;
  if (currentDevice) {
    currentDevice.storage.clear();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      currentDevice.storage.set(k, localStorage.getItem(k)!);
    }
  }
  localStorage.clear();
  for (const [k, v] of dev.storage) localStorage.setItem(k, v);
  resetDbInstance();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = dev.factory;
  currentDevice = dev;
}

const T = (hhmm: string) => Date.parse(`2026-10-02T${hhmm}:00+05:00`);
function at(hhmm: string): void { vi.setSystemTime(T(hhmm)); }

async function flushRaw() {
  const r = await LocalStoreSyncService.flushPending(true);
  return r;
}

async function flush(): Promise<void> {
  const r = await flushRaw();
  expect(r.failed, 'выгрузка упала').toBe(0);
  expect(r.skippedOversized, 'запись сочтена слишком большой').toBe(0);
}

async function localDialogue(id: string): Promise<AIDialogue> {
  return (await (await getLocalDb()).get('aiDialogues', id)) as AIDialogue;
}

const heads = (d: AIDialogue) => d.messages.map(m => m.content.split(' ')[0]);
const cloudKeys = (id: string) => [...cloud.values()]
  .filter(r => r.key === id || r.key.startsWith(`${id}#`) || r.key.startsWith(segmentPrefixOf(id)))
  .map(r => r.key).sort();
const segKeys = (id: string) => cloudKeys(id).filter(k => k.startsWith(segmentPrefixOf(id)));
const headPayload = (id: string) => cloud.get(rowKey('aiDialogues', id))!.payload as {
  head: boolean; updatedAt: number; title?: string; deletedAt?: number; personaName?: string; segments: Array<{ key: string; firstAt: number; bytes: number; count: number }>;
};

// Три куска по 100 000 знаков (appendMessage режет именно так) — ~570 КБ в
// UTF-8: реплика сама больше окна сегмента (400 КБ), поэтому уходит в своё окно.
const BIG = 'ы'.repeat(95_000);

async function bigDialogue(): Promise<AIDialogue> {
  const a = new Device();
  switchTo(a);
  at('09:00');
  return await AIDialogueService.create({
    title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    messages: [
      { role: 'user', content: 'Вопрос ' + BIG, reasoning: BIG },
      { role: 'assistant', content: 'Ответ ' + BIG },
    ],
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  cloud.clear();
  localStorage.clear();
  ops.length = 0;
  useActivityLogStore.getState().clearLog();
  deleteKeysCalls = [];
  casResult = true;
  casThrows = false;
  currentDevice = null;
  LocalStoreSyncService['pending'].clear();
  await (await getLocalDb()).clear('aiDialogues');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('M-5: выгрузка head’ом и сегментами', () => {
  it('крупный диалог ложится head’ом и сегментами, а не страницами с манифестом', async () => {
    const d = await bigDialogue();
    await flush();

    expect(headPayload(d.id).head, 'строка `key` не является head').toBe(true);
    expect(segKeys(d.id).length, 'сегментов нет').toBeGreaterThan(1);
    expect(cloudKeys(d.id).filter(k => k.includes('#')), 'рядом легли страницы прежнего формата').toEqual([]);
    // Единственное поле, на которое смотрит клиент 0.9.28/0.9.29, — `data`.
    for (const k of cloudKeys(d.id)) expect(cloud.get(rowKey('aiDialogues', k))!.payload).not.toHaveProperty('data');
  });

  it('head подписывается после тела: сначала строки окон, затем условная запись строки `key`', async () => {
    const d = await bigDialogue();
    await flush();
    const body = ops.findIndex(o => o.startsWith('pages:'));
    const head = ops.findIndex(o => o.startsWith('cas:'));
    expect(body, 'тела не было').toBeGreaterThanOrEqual(0);
    expect(head, 'head не ушёл условной записью').toBeGreaterThan(body);
    // Один CAS на выгрузку: условная запись только у указателя, у сегментов его нет.
    expect(ops.filter(o => o === `cas:${d.id}`)).toHaveLength(1);
  });

  it('дописка в хвост пишет ОДНО окно, а не весь диалог', async () => {
    const d = await bigDialogue();
    await flush();
    const before = segKeys(d.id);
    ops.length = 0;

    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Ещё вопрос', 'Ещё ответ');
    await flush();

    const wrote = ops.find(o => o.startsWith('pages:'));
    expect(wrote, 'ни одного окна не записано').toBe('pages:1');
    const after = segKeys(d.id);
    // Все прежние окна, кроме открытого, остались байт в байт; открытое уехало
    // новым ключом, а его прежняя строка — в уборку.
    expect(after.length).toBe(before.length);
    expect(after.filter(k => !before.includes(k)).length).toBe(1);
    expect(headPayload(d.id).segments.map(s => s.key).sort()).toEqual(after);
  });

  it('правка заголовка не переписывает ни одного сегмента', async () => {
    const d = await bigDialogue();
    await flush();
    const before = segKeys(d.id);
    ops.length = 0;

    at('09:40');
    await AIDialogueService.updateTitle(d.id, 'Другое имя');
    await flush();

    expect(ops.filter(o => o.startsWith('pages:')), `заголовок перезаписал окна: ${ops.join(', ')}`).toEqual([]);
    expect(segKeys(d.id)).toEqual(before);
    expect(headPayload(d.id).title).toBe('Другое имя');
  });

  it('повторная выгрузка без изменений не пишет ничего', async () => {
    const d = await bigDialogue();
    await flush();
    const before = headPayload(d.id);
    ops.length = 0;
    await flush();
    expect(ops, `пустая выгрузка что-то написала: ${ops.join(', ')}`).toEqual([]);
    expect(headPayload(d.id)).toEqual(before);
  });

  it('выгрузка, поставленная без изменений, head не переписывает (прод, 2026-10-07)', async () => {
    // Head переписывался раз в 2 минуты: каждая запись — новая серверная отметка,
    // и забор на всех устройствах принимал её за правку с другого устройства.
    const d = await bigDialogue();
    await flush();
    const before = headPayload(d.id);
    ops.length = 0;
    at('09:05');
    LocalStoreSyncService.scheduleStoreSync('aiDialogues', d.id);
    await flush();
    expect(ops, `выгрузка без изменений переписала облако: ${ops.join(', ')}`).toEqual([]);
    expect(headPayload(d.id)).toEqual(before);
  });

  it('миграция: legacy-страницы с манифестом читаются, союз уходит сегментами, страницы сносятся', async () => {
    const d = await bigDialogue();
    await flush();
    const rec = await localDialogue(d.id);
    // 0.9.28 переложил копию на страницы `key#N` и стёр строку `key`.
    for (const k of cloudKeys(d.id)) cloud.delete(rowKey('aiDialogues', k));
    const json = JSON.stringify(rec);
    const half = Math.ceil(json.length / 2);
    [json.slice(0, half), json.slice(half)].forEach((data, i) => {
      const key = `${d.id}#${rec.updatedAt}#${i}`;
      cloud.set(rowKey('aiDialogues', key), { store: 'aiDialogues', key, payload: { data, updatedAt: rec.updatedAt, page: i, totalPages: 2 } });
    });

    at('10:00');
    await AIDialogueService.appendMessage(d.id, 'Новый вопрос', 'Новый ответ');
    await flush();

    expect(cloudKeys(d.id).filter(k => k.includes('#')), 'страницы прежней копии остались в облаке').toEqual([]);
    expect(headPayload(d.id).head).toBe(true);
    expect(heads(await localDialogue(d.id))).toEqual(['Вопрос', 'Ответ', 'Новый', 'Новый']);
  });

  it('проигравший CAS не сносит окна, которые мог принять победитель, и повторяет союз: ни один ход не потерян', async () => {
    const d = await bigDialogue();
    await flush();
    const winner = new Map([...cloud]);
    const before = segKeys(d.id);

    // Чужая выгрузка села в облако, пока мы читали: CAS не проходит.
    casResult = false;
    at('10:10');
    await AIDialogueService.appendMessage(d.id, 'Мой ход', 'Мой ответ');
    const r = await flushRaw();
    casResult = true;

    expect(r.failed, 'выгрузка не должна считаться успешной').toBe(1);
    // Облако победителя не тронуто. Сверяем по снимку победителя, а не по
    // текущему списку строк: с R7Q-005 строки проигравшего остаются живыми, и
    // «каждая текущая строка была у победителя» больше не то, что проверяется.
    for (const k of [...winner.keys()]) expect(cloud.has(k), `строка победителя удалена: ${k}`).toBe(true);
    expect(headPayload(d.id).updatedAt, 'head победителя перезаписан').toBe(winner.get(rowKey('aiDialogues', d.id))!.payload.updatedAt);

    // R7Q-005: строки проигравшей попытки сразу не сносятся. Проигравший не может
    // знать, успел ли победитель перечитать облако и принять ровно их (байты
    // совпадают — план переиспользует), а безусловное удаление оставляло head на
    // отсутствующее окно, и третий читатель отказывал всему диалогу. Названное
    // текущим head'ом не удаляется, неназванное доживает до штатной уборки после
    // grace-периода (это проверяет dialogueUploadPaged.s49 и новый
    // dialogueCasLoserWindows.r7q005).
    const leftovers = segKeys(d.id).filter(k => !before.includes(k));
    expect(leftovers.length, `окно проигравшей попытки не осталось в облаке: ${before.join(', ')} → ${segKeys(d.id).join(', ')}`)
      .toBeGreaterThan(0);
    const named = new Set((headPayload(d.id).segments as Array<{ key: string }>).map(s => s.key));
    for (const k of named) expect(cloud.has(rowKey('aiDialogues', k)), `head называет мёртвую строку ${k}`).toBe(true);

    // Штатный повтор доводит дело: ход в облаке, head свежий.
    const r2 = await flushRaw();
    expect(r2.failed).toBe(0);
    expect(heads(await localDialogue(d.id))).toEqual(['Вопрос', 'Ответ', 'Мой', 'Мой']);
  });

  it('неполная копия: писатель чинит её и переподписывает head, читатель отказывает', async () => {
    const d = await bigDialogue();
    await flush();
    const missing = segKeys(d.id)[1]!;
    cloud.delete(rowKey('aiDialogues', missing));
    const before = headPayload(d.id);

    at('11:00');
    await AIDialogueService.appendMessage(d.id, 'Ход при неполном облаке', 'Ответ');
    const r = await flushRaw();
    // Писатель знает больше облака: локальный союз у него целый. Отказываться
    // навсегда значило бы, что повреждённую копию не восстановит никто.
    expect(r.failed, 'выгрузка не починила неполную копию').toBe(0);
    const after = headPayload(d.id);
    expect(after.segments.map(s => s.key)).not.toEqual(before.segments.map(s => s.key));
    // Облако снова замкнуто: ни одной строки вне head’а и ни одного окна head’а
    // без строки.
    const named = new Set(after.segments.map(s => s.key));
    expect(segKeys(d.id).filter(k => !named.has(k))).toEqual([]);
    expect([...named].filter(k => !cloud.has(rowKey('aiDialogues', k)))).toEqual([]);
    expect(missing === after.segments[1]!.key, 'прежняя пропавшая строка воскресла как ни в чём не бывало').toBe(false);
    // Починка не должна быть тихой: журнал активности обязан знать, что облако
    // было неполным (иначе «самое важное молча починилось» неотличимо от
    // «самое важное молча проглотили»).
    const entries = useActivityLogStore.getState().entries.filter(e => e.message === 'activity_dialogue_cloud_unreadable');
    expect(entries.map(e => e.context?.action)).toContain('uploadDialogue_incomplete_cloud');
  });

  it('нечитаемая (не отсутствующая) строка, которую называет head: выгрузка падает', async () => {
    const d = await bigDialogue();
    await flush();
    const broken = segKeys(d.id)[1]!;
    cloud.get(rowKey('aiDialogues', broken))!.payload.messages = '{не json';
    const snapshot = new Map([...cloud]);
    ops.length = 0;

    at('11:20');
    await AIDialogueService.appendMessage(d.id, 'Ход при битом окне', 'Ответ');
    const r = await flushRaw();

    expect(r.failed, 'нечитаемое окно приняли за «можно перезаписать»').toBe(1);
    expect(ops.filter(o => o.startsWith('pages:') || o.startsWith('cas:') || o.startsWith('save:')), `писали поверх нечитаемой строки: ${ops.join(', ')}`).toEqual([]);
    for (const [k, v] of snapshot) expect(cloud.get(k)!.payload).toEqual(v.payload);
  });

  it('забор неполной копии отказывает: локальный диалог не укорачивается', async () => {
    const d = await bigDialogue();
    await flush();
    cloud.delete(rowKey('aiDialogues', segKeys(d.id)[1]!));

    switchTo(new Device());
    at('11:40');
    const r = await restoreAIDataFromCloud(UID);
    expect(r.failed, 'неполный набор окон не посчитан отказом').toBeGreaterThan(0);
    const mine = await (await getLocalDb()).get('aiDialogues', d.id);
    expect(mine, 'забор приткнул укороченную копию поверх пустой базы').toBeUndefined();
  });

  it('инкрементальный забор добирает окно с прежней отметкой: диалог приезжает целиком', async () => {
    const d = await bigDialogue();
    await flush();                                     // окна легли с отметкой 09:00
    at('10:30');
    await AIDialogueService.appendMessage(d.id, 'Хвост', 'Хвост');
    await flush();                                     // head свежий, закрытые окна — прежние

    const cut = T('10:00');
    const head = headPayload(d.id);
    const stale = segKeys(d.id).find(k => Number(cloud.get(rowKey('aiDialogues', k))!.payload.updatedAt) <= cut);
    expect(stale, 'ни одно окно не старше среза — случай не покрыт').toBeTypeOf('string');
    expect(head.updatedAt).toBeGreaterThan(cut);

    switchTo(new Device());
    at('11:00');
    const r = await restoreAIDataFromCloud(UID, { sinceMs: cut });
    expect(r.failed, 'забор отказался от диалога из-за старого окна').toBe(0);
    expect(heads(await localDialogue(d.id))).toEqual(['Вопрос', 'Ответ', 'Хвост', 'Хвост']);
  });

  it('удаление диалога сносит и head, и все его сегменты', async () => {
    const d = await bigDialogue();
    await flush();
    expect(segKeys(d.id).length).toBeGreaterThan(1);

    at('12:00');
    await AIDialogueService.delete(d.id);
    await flush();
    // Надгробие живёт в head’е: строка остаётся, но диалог мёртв.
    expect(headPayload(d.id).deletedAt, 'head не несёт надгробие').toBeTypeOf('number');

    switchTo(new Device());
    await (await getLocalDb()).delete('aiDialogues', d.id);
    LocalStoreSyncService.scheduleStoreDelete('aiDialogues', d.id);
    await flush();
    expect(cloudKeys(d.id), `после удаления остались строки: ${cloudKeys(d.id).join(', ')}`).toEqual([]);
  });

  it('обрыв после тела: окна легли, head не подписан — повтор принимает их и дописывает указатель', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    // Первая же выгрузка крупного диалога обрывается после записи тела.
    casThrows = true;
    const d = await bigDialogue();
    const r = await flushRaw();
    casThrows = false;
    expect(r.failed, 'сбой сети не должен считаться успехом').toBe(1);
    expect(cloud.has(rowKey('aiDialogues', d.id)), 'head всё-таки подписался при сбое').toBe(false);
    const orphans = segKeys(d.id);
    expect(orphans.length, 'тело не легло — случай не покрыт').toBeGreaterThan(1);

    ops.length = 0;
    const r2 = await flushRaw();
    expect(r2.failed).toBe(0);
    // Ключевое: повтор НЕ переписывает те же байты вторично.
    expect(ops.filter(o => o.startsWith('pages:')), `повтор переписал готовые окна: ${ops.join(', ')}`).toEqual([]);
    expect(ops.some(o => o.startsWith(`cas:${d.id}`)), 'head не дописан').toBe(true);
    const named = new Set(headPayload(d.id).segments.map(s => s.key));
    expect([...named].sort()).toEqual(orphans);
  });

  it('чистые ходы: ни одной строки, которой head не называет', async () => {
    const d = await bigDialogue();
    await flush();
    at('13:00');
    await AIDialogueService.appendMessage(d.id, 'X ' + BIG, 'Y ' + BIG, BIG);
    await flush();
    at('13:30');
    await AIDialogueService.appendMessage(d.id, 'Z', 'W');
    await flush();

    const named = new Set(headPayload(d.id).segments.map(s => s.key));
    for (const k of segKeys(d.id)) expect(named.has(k), `head не называет ${k}`).toBe(true);
    // И порядок окон — хронологический: два устройства собирают один и тот же диалог.
    const firsts = headPayload(d.id).segments.map(s => s.firstAt);
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
  });

  it('R-2: удачная одиночная строка сносит осиротевшие окна этого диалога', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();
    // Обрыв прошлой сегментной выгрузки: тела легли, head под ними не подписан,
    // а устройство-писатель больше к диалогу не вернётся.
    const orphan = `${d.id}@seg${T('08:00')}-deadbeef`;
    cloud.set(rowKey('aiDialogues', orphan), {
      store: 'aiDialogues', key: orphan,
      payload: { seg: true, headKey: d.id, firstAt: T('08:00'), lastAt: T('08:10'), updatedAt: T('08:10'), messages: '[]' },
      stamped_at: T('08:10'),
    });

    at('09:10');
    await AIDialogueService.appendMessage(d.id, 'Ещё вопрос', 'Ещё ответ');
    await flush();

    expect((cloud.get(rowKey('aiDialogues', d.id))!.payload as { head?: boolean }).head,
      'мелкий диалог уехал head’ом, а не одиночной строкой').toBeUndefined();
    expect(segKeys(d.id), `осиротевшие окна остались в облаке навсегда: ${segKeys(d.id).join(', ')}`).toEqual([]);
    expect(cloudKeys(d.id), 'у диалога осталась лишняя строка').toEqual([d.id]);
  });

  it('R-3: надгробие уходит head-формой, которую 0.9.29 обходит молча', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();

    at('09:20');
    await AIDialogueService.delete(d.id);
    await flush();

    const row = cloud.get(rowKey('aiDialogues', d.id))!.payload as Record<string, unknown>;
    expect(row.head, 'надгробие уехало не head-строкой').toBe(true);
    expect(typeof row.deletedAt, 'head не несёт надгробие').toBe('number');
    expect(row.segments, 'надгробие называет окна').toEqual([]);
    // Единственное поле, которое читает 0.9.29. `data` здесь = пустой диалог в
    // списке старого клиента, а затем `cleanupEmpty` и жёсткое удаление строки.
    expect(row, 'в строке есть `data` — старый клиент прочитает надгробие').not.toHaveProperty('data');
    expect(oldClientWrites(
      [...cloud.values()].map(r => ({ store: r.store, key: r.key, payload: r.payload })),
      new Map<string, AIDialogue>([[d.id, { ...d, messages: d.messages }]]),
    ), 'старый клиент что-то записал бы поверх удаления').toEqual([]);
  });
});
