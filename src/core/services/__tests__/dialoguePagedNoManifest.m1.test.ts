// M-1 (ag-tickets-2026-10-02-merge-and-crisis.md): постраничная копия диалога БЕЗ
// манифеста обязана выгружаться. Прежде readCloudDialogue отдавала для страниц
// expected = отметку страниц (version.updatedAt), а условная запись (CAS) нацелена
// на строку `key`: у legacy-копии 0.9.28 (`key#N`, строки `key` нет) её нет вовсе
// либо там другая отметка → CAS не проходит никогда → диалог > 500 КБ не уезжает
// в облако ни при какой попытке. Порт repro-стенда rv3.s49.test.ts, P1–P4.
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
    deleteLocalStoreStalePages: async (_uid: string, store: string, key: string, keepStamp: number) => {
      for (const [k, r] of cloud) if (r.store === store && r.key.startsWith(`${key}#`) && !r.key.startsWith(`${key}#${keepStamp}#`)) cloud.delete(k);
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

// appendMessage режет реплику и рассуждение по 100 000 знаков; три таких куска
// (вопрос, ответ, рассуждение) — ~570 КБ в UTF-8, больше порога страницы (500 КБ).
const BIG = 'ы'.repeat(95_000);

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

async function flushRaw() { return LocalStoreSyncService.flushPending(true); }

function legacyPages(rec: AIDialogue, n = 2) {
  // 0.9.28 generic path: pages `key#i`, payload {data, updatedAt, page, totalPages}; exact row `key` deleted.
  const json = JSON.stringify(rec);
  const size = Math.ceil(json.length / n);
  cloud.delete(rowKey('aiDialogues', rec.id));
  for (let i = 0; i < n; i++) {
    const key = `${rec.id}#${i}`;
    cloud.set(rowKey('aiDialogues', key), { store: 'aiDialogues', key, payload: { data: json.slice(i * size, (i + 1) * size), updatedAt: rec.updatedAt, page: i, totalPages: n } });
  }
}


describe('M-1: постраничная копия диалога без манифеста выгружается', () => {
  it('P1: cloud copy paged by a 0.9.28 client (key#N, no manifest) — new client append uploads', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос ' + BIG + BIG + BIG }, { role: 'assistant', content: 'Ответ' }],
    });
    // simulate: this dialogue was uploaded by 0.9.28 (pending upload cleared)
    legacyPages(await localDialogue(d.id));
    (LocalStoreSyncService as unknown as { pending: Map<string, unknown> }).pending.clear();
    localStorage.clear();
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Новый вопрос', 'Новый ответ');
        for (let i = 0; i < 3; i++) await flushRaw();
    const c = new Device(); switchTo(c); at('10:00');
    await restoreAIDataFromCloud(UID);
    const onC = heads(await localDialogue(d.id));
    expect(onC).toEqual(['Вопрос', 'Ответ', 'Новый', 'Новый']);
  });

  it('P2: 0.9.28 client appends to a new-format paged dialogue (deletes manifest row, writes key#N) — new client can upload after', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос ' + BIG + BIG + BIG }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();
    // M-5: крупной копией управляет head (прежний манифест версии), и именно его
    // сносит 0.9.28, перекладывая диалог на страницы `key#N`.
    expect(cloud.get(rowKey('aiDialogues', d.id))!.payload.head).toBe(true);
    // old client: restore LWW + append without ids, generic upload
    const rec = await localDialogue(d.id);
    at('09:20');
    const old = { ...rec, messages: [...rec.messages, { role: 'user', content: 'Старый вопрос' }, { role: 'assistant', content: 'Старый ответ' }], updatedAt: Date.now() } as AIDialogue;
    legacyPages(old); // writes key#0,key#1 and deletes the exact row (manifest); key#T#i stay (Number('T#i') is NaN)
    at('09:30');
    await AIDialogueService.appendMessage(d.id, 'Новый вопрос', 'Новый ответ');
        for (let i = 0; i < 3; i++) await flushRaw();
    const c = new Device(); switchTo(c); at('10:00');
    await restoreAIDataFromCloud(UID);
    expect(heads(await localDialogue(d.id))).toEqual(['Вопрос', 'Ответ', 'Старый', 'Старый', 'Новый', 'Новый']);
  });

  it('P3: crash between pages and manifest on the first paged upload — next flush heals', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос ' + BIG + BIG + BIG }, { role: 'assistant', content: 'Ответ' }],
    });
    const { DataProvider } = await import('../../data');
    const orig = DataProvider.saveLocalStoreRecordIfUnchanged;
    (DataProvider as { saveLocalStoreRecordIfUnchanged: unknown }).saveLocalStoreRecordIfUnchanged = async () => { throw new Error('network'); };
    await flushRaw();
    (DataProvider as { saveLocalStoreRecordIfUnchanged: unknown }).saveLocalStoreRecordIfUnchanged = orig;
    at('09:05');
    await AIDialogueService.appendMessage(d.id, 'Новый вопрос', 'Новый ответ');
    const r2 = await flushRaw();
    expect(r2.failed).toBe(0);
  });

  it('P4: crash between pages and manifest over an existing single row — next flush heals', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();
    at('09:01');
    await AIDialogueService.appendMessage(d.id, 'Большой ' + BIG, 'Большой ' + BIG, BIG);
    const { DataProvider } = await import('../../data');
    const orig = DataProvider.saveLocalStoreRecordIfUnchanged;
    (DataProvider as { saveLocalStoreRecordIfUnchanged: unknown }).saveLocalStoreRecordIfUnchanged = async () => { throw new Error('network'); };
    await flushRaw();
    (DataProvider as { saveLocalStoreRecordIfUnchanged: unknown }).saveLocalStoreRecordIfUnchanged = orig;
    at('09:05');
    await AIDialogueService.appendMessage(d.id, 'Новый вопрос', 'Новый ответ');
        for (let i = 0; i < 3; i++) await flushRaw();
    const c = new Device(); switchTo(c); at('10:00');
    await restoreAIDataFromCloud(UID);
    expect(heads(await localDialogue(d.id))).toEqual(['Вопрос', 'Ответ', 'Большой', 'Большой', 'Новый', 'Новый']);
  });
});
