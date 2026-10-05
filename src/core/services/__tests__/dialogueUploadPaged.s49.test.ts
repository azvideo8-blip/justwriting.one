import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { AIDialogueService } from '../../../features/ai/services/AIDialogueService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';

// S-49: диалог крупнее одной страницы (> 500 КБ) лежит в облаке страницами.
// Выгрузка читала только строку `key`, страницы читались как «строки нет»:
// устройство вставляло свою копию без хода другого и сносило его страницы.
// Облако здесь — память с теми же операциями, что у провайдера (строка `key`,
// страницы `key#…`, условная запись); выгрузка и забор — настоящие.

const UID = 'u_s49';

type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
let onCloudRead: (() => void) | null = null;
const casCalls = vi.fn();

vi.mock('../../data', () => ({
  DataProvider: {
    getLocalStoreRecordsByKeyPrefix: async (_uid: string, store: string, prefix: string) =>
      [...cloud.values()].filter(r => r.store === store && r.key.startsWith(prefix)),
    deleteLocalStoreRecordsByKeys: async (_uid: string, store: string, keys: string[]) => {
      for (const k of keys) cloud.delete(`${store}:${k}`);
    },
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
      // Срабатывает после обоих чтений: строки и страниц.
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
      casCalls(expected);
      const cur = cloud.get(rowKey(store, key));
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      cloud.set(rowKey(store, key), { store, key, payload });
      return true;
    },
    deleteLocalStorePagedRecords: async (_uid: string, store: string, key: string) => {
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`)) cloud.delete(k);
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

async function flush(): Promise<void> {
  const r = await LocalStoreSyncService.flushPending(true);
  expect(r.failed, 'выгрузка упала').toBe(0);
  expect(r.skippedOversized, 'запись сочтена слишком большой').toBe(0);
}

async function localDialogue(id: string): Promise<AIDialogue> {
  return (await (await getLocalDb()).get('aiDialogues', id)) as AIDialogue;
}

/** Реплики диалога без длинных тел — по первым словам. */
const heads = (d: AIDialogue) => d.messages.map(m => m.content.split(' ')[0]);
const cloudKeys = (id: string) => [...cloud.values()].filter(r => r.key === id || r.key.startsWith(`${id}#`) || r.key.startsWith(`${id}@seg`)).map(r => r.key).sort();

// appendMessage режет реплику и рассуждение по 100 000 знаков; три таких куска
// (вопрос, ответ, рассуждение) — ~570 КБ в UTF-8, больше порога страницы (500 КБ).
const BIG = 'ы'.repeat(95_000);
const PREFIX = ['Общий', 'Общий'];

async function sharedPrefix(a: Device, b: Device): Promise<AIDialogue> {
  switchTo(a);
  at('09:00');
  const d = await AIDialogueService.create({
    title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    messages: [{ role: 'user', content: 'Общий вопрос' }, { role: 'assistant', content: 'Общий ответ' }],
  });
  await flush();
  switchTo(b);
  at('09:01');
  await restoreAIDataFromCloud(UID);
  expect(heads(await localDialogue(d.id))).toEqual(PREFIX);
  return d;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  cloud.clear();
  casCalls.mockClear();
  onCloudRead = null;
  currentDevice = null;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('S-49: dialogues over one page merge and write with a condition too', () => {
  it('repro 1: A grows the dialogue past 500 KB; B appends a small turn; a fresh device C restores both turns', async () => {
    const a = new Device();
    const b = new Device();
    const c = new Device();
    const d = await sharedPrefix(a, b);

    switchTo(a);
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Большой вопрос с A ' + BIG, 'Большой ответ с A ' + BIG, BIG);
    await flush();
    expect(cloudKeys(d.id).some(k => k.includes('@seg')), 'диалог A не ушёл сегментами').toBe(true);

    switchTo(b);
    at('10:00');
    await AIDialogueService.appendMessage(d.id, 'Короткий вопрос с B', 'Короткий ответ с B');
    await flush();

    switchTo(c);
    at('10:05');
    const r = await restoreAIDataFromCloud(UID);
    expect(r.failed, 'забор на C отказался от записи').toBe(0);
    const onC = heads(await localDialogue(d.id));
    expect(onC, `ход A пропал после выгрузки B: ${JSON.stringify(onC)}`).toEqual([...PREFIX, 'Большой', 'Большой', 'Короткий', 'Короткий']);
    // B слил союз и к себе — иначе его следующая выгрузка снова затрёт A.
    switchTo(b);
    expect(heads(await localDialogue(d.id))).toEqual(onC);
  });

  it('repro 2: both copies paged, A appends qA and B appends qB — C has both', async () => {
    const a = new Device();
    const b = new Device();
    const c = new Device();
    const d = await sharedPrefix(a, b);

    // Общая большая основа: A дописал, выгрузил; B забрал — обе копии больше страницы.
    switchTo(a);
    at('09:10');
    await AIDialogueService.appendMessage(d.id, 'Основа вопрос ' + BIG, 'Основа ответ ' + BIG, BIG);
    await flush();
    expect(cloudKeys(d.id).length, 'основа не ушла страницами').toBeGreaterThan(1);
    switchTo(b);
    at('09:11');
    expect((await restoreAIDataFromCloud(UID)).failed).toBe(0);
    expect(heads(await localDialogue(d.id))).toEqual([...PREFIX, 'Основа', 'Основа']);

    switchTo(a);
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с A ' + BIG, 'Ответ с A');
    await flush();
    switchTo(b);
    at('10:00');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B ' + BIG, 'Ответ с B');
    await flush();

    switchTo(c);
    at('10:05');
    expect((await restoreAIDataFromCloud(UID)).failed).toBe(0);
    const onC = heads(await localDialogue(d.id));
    expect(onC, `ход одного из устройств пропал: ${JSON.stringify(onC)}`)
      .toEqual([...PREFIX, 'Основа', 'Основа', 'Вопрос', 'Ответ', 'Вопрос', 'Ответ']);
    expect(onC.length).toBe(8);
    const texts = (await localDialogue(d.id)).messages.map(m => m.content.split(' ').slice(0, 3).join(' '));
    expect(texts).toContain('Вопрос с A');
    expect(texts).toContain('Вопрос с B');
    // M-5: в облаке — head и ровно те сегменты, которые он называет. Строки
    // проигравших попыток сносит выигравший CAS, страницы прежней копии уходит
    // вслед за ними (миграция).
    const head = cloud.get(rowKey('aiDialogues', d.id))!.payload as { head: boolean; segments: Array<{ key: string }> };
    expect(head.head).toBe(true);
    const named = new Set(head.segments.map(s => s.key));
    const segs = cloudKeys(d.id).filter(k => k.includes('@seg'));
    expect(segs.length, `лишние сегменты: ${segs.join(', ')}`).toBe(named.size);
    for (const k of segs) expect(named.has(k), `head не называет ${k}`).toBe(true);
    expect(cloudKeys(d.id).filter(k => k.includes('#')), 'страницы прежней копии остались').toEqual([]);
  });

  it('a compare-and-swap failure in the page path re-merges: no turn lost, the losing pages are removed', async () => {    const a = new Device();
    const b = new Device();
    const d = await sharedPrefix(a, b);

    switchTo(b);
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B ' + BIG, 'Ответ с B ' + BIG, BIG);
    const bRecord = await localDialogue(d.id);

    switchTo(a);
    at('10:00');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с A ' + BIG, 'Ответ с A ' + BIG, BIG);
    // Пока A читает облако, туда садится запись B — страницами и манифестом.
    onCloudRead = () => {
      const json = JSON.stringify(bRecord);
      const half = Math.ceil(json.length / 2);
      const chunks = [json.slice(0, half), json.slice(half)];
      chunks.forEach((data, i) => {
        const key = `${d.id}#${bRecord.updatedAt}#${i}`;
        cloud.set(rowKey('aiDialogues', key), { store: 'aiDialogues', key, payload: { data, updatedAt: bRecord.updatedAt, page: i, totalPages: 2 } });
      });
      cloud.set(rowKey('aiDialogues', d.id), { store: 'aiDialogues', key: d.id, payload: { manifest: true, updatedAt: bRecord.updatedAt, totalPages: 2 } });
    };
    casCalls.mockClear();
    await flush();

    expect(casCalls.mock.calls.length, 'условная запись не повторилась после конфликта').toBe(2);
    switchTo(new Device());
    at('10:05');
    expect((await restoreAIDataFromCloud(UID)).failed).toBe(0);
    const texts = (await localDialogue(d.id)).messages.map(m => m.content.split(' ').slice(0, 3).join(' '));
    expect(texts, `ход потерян: ${JSON.stringify(texts)}`).toEqual(['Общий вопрос', 'Общий ответ', 'Вопрос с B', 'Ответ с B', 'Вопрос с A', 'Ответ с A']);
    const headAfter = cloud.get(rowKey('aiDialogues', d.id))!.payload as { head: boolean; segments: Array<{ key: string }> };
    expect(headAfter.head, 'победитель оставил манифест вместо head').toBe(true);
    // M-5: чистятся обе ветки — и осиротевшие сегменты проигравшей попытки, и
    // страницы legacy-копии, на которую наехал CAS.
    const named = new Set(headAfter.segments.map(s => s.key));
    for (const k of cloudKeys(d.id).filter(x => x.includes('@seg'))) expect(named.has(k), `head не называет ${k}`).toBe(true);
    expect(cloudKeys(d.id).filter(k => k.includes('#')), `страницы остались: ${cloudKeys(d.id).join(', ')}`).toEqual([]);
  });

  it('сжатие обратно под размер строки оставляет формат head и убирает лишние строки', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос ' + BIG + BIG + BIG }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();
    expect(cloudKeys(d.id).length).toBeGreaterThan(1);

    at('09:10');
    const db = await getLocalDb();
    const big = (await db.get('aiDialogues', d.id))!;
    await AIDialogueService.deleteMessage(d.id, big.messages[0]!.id!);
    await flush();

    // Формат не мигает туда-сюда: head остаётся head’ом (переезд на одну строку
    // означал бы, что клиент снова видит смесь форматов). Убирается только то,
    // что head больше не называет.
    const headRow = cloud.get(rowKey('aiDialogues', d.id))!.payload as { head?: boolean, segments?: Array<{ key: string }> };
    expect(headRow.head, 'head сменился одиночной строкой').toBe(true);
    const named = new Set((headRow.segments ?? []).map(s => s.key));
    for (const k of cloudKeys(d.id).filter(x => x.includes('@seg'))) expect(named.has(k), `head не называет ${k}`).toBe(true);
    expect(cloudKeys(d.id).filter(k => k.includes('#')), 'остались страницы прежней версии').toEqual([]);
  });
});
