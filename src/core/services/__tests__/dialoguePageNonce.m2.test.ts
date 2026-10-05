// M-2 (ag-tickets-2026-10-02-merge-and-crisis.md): ключ страницы `key#<stamp>#<i>`
// не уникален между попытками одной выгрузки: отметка победителя =
// max(now, a+1, b+1), и осиротевшая страница неудавшейся попытки ложилась под
// отметку победителя -> «pages beyond N» -> запись отказывалась читаться везде и
// навсегда, а чистка проигравшего сносила страницы победителя (тот же префикс).
// Теперь у попытки своя случайная метка: манифест называет {updatedAt, nonce,
// totalPages}, чтение берёт только страницы своего nonce, победитель чистит
// чужие nonce, проигравший — только свои. Порт P5-P6 из rv3.s49.test.ts.
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

type Row = { store: string; key: string; payload: Record<string, unknown>; stamped_at?: number };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
let onCloudRead: (() => void) | null = null;
const casCalls = vi.fn();

vi.mock('../../data', () => ({
  DataProvider: {
    getLocalStoreRecordsByKeyPrefix: async (_uid: string, store: string, prefix: string) =>
      [...cloud.values()]
        .filter(r => r.store === store && r.key.startsWith(prefix))
        .map(r => ({ store: r.store, key: r.key, payload: r.payload, stamped_at: r.stamped_at })),
    deleteLocalStoreRecordsByKeys: async (_uid: string, store: string, keys: string[]) => {
      for (const k of keys) cloud.delete(`${store}:${k}`);
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
    getLocalStoreRecordPages: async (_uid: string, store: string, key: string) => {
      const out = [...cloud.values()].filter(r => r.store === store && r.key.startsWith(`${key}#`));
      // Срабатывает после обоих чтений: строки и страниц.
      if (onCloudRead) { const h = onCloudRead; onCloudRead = null; h(); }
      return out;
    },
    saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
      cloud.set(rowKey(store, key), { store, key, payload, stamped_at: Date.now() });
    },
    saveLocalStoreRecordPages: async (_uid: string, store: string, pages: Array<{ key: string; payload: Record<string, unknown> }>) => {
      for (const p of pages) cloud.set(rowKey(store, p.key), { store, key: p.key, payload: p.payload, stamped_at: Date.now() });
    },
    saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      casCalls(expected);
      const cur = cloud.get(rowKey(store, key));
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      cloud.set(rowKey(store, key), { store, key, payload, stamped_at: Date.now() });
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

async function flushRaw() { return LocalStoreSyncService.flushPending(true); }


describe('M-2: страницы одной попытки отличаются от страниц другой', () => {
  it('P5: рост → сжатие → рост на двух устройствах', async () => {
    const a = new Device(); const b = new Device();
    const d = await sharedPrefix(a, b);
    switchTo(a); at('09:10');
    await AIDialogueService.appendMessage(d.id, 'Большой ' + BIG, 'Большой ' + BIG, BIG);
    await flush();
    switchTo(b); at('09:11');
    await restoreAIDataFromCloud(UID);
    const big = (await localDialogue(d.id)).messages.find(m => m.content.startsWith('Большой'))!;
    await AIDialogueService.deleteMessage(d.id, big.id!);
    const big2 = (await localDialogue(d.id)).messages.find(m => m.content.startsWith('Большой'))!;
    await AIDialogueService.deleteMessage(d.id, big2.id!);
    await flush();
    switchTo(a); at('09:20');
    await AIDialogueService.appendMessage(d.id, 'Снова ' + BIG, 'Снова ' + BIG, BIG);
    await flush();
    const c = new Device(); switchTo(c); at('10:00');
    expect((await restoreAIDataFromCloud(UID)).failed).toBe(0);
    expect(heads(await localDialogue(d.id))).toEqual([...PREFIX, 'Снова', 'Снова']);
  });

  it('P6: осиротевшие строки неудавшейся попытки не коверают чтение и не мешают победителю', async () => {
    const x = new Device(); const a = new Device(); const b = new Device();
    switchTo(x); at('10:00');
    const d = await AIDialogueService.create({ title: 'Р', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Общий вопрос ' + BIG + BIG + BIG }, { role: 'assistant', content: 'Общий ответ' }] });
    await flush();
    for (const dev of [a, b]) { switchTo(dev); at('09:30'); await restoreAIDataFromCloud(UID); }
    const baseKeys = new Set(cloudKeys(d.id));
    // A: сегменты ушли в облако, а условная запись head'а упала по «сети».
    switchTo(a); at('09:31');
    await AIDialogueService.appendMessage(d.id, 'A ' + BIG, 'A ' + BIG, BIG);
    const { DataProvider } = await import('../../data');
    const orig = DataProvider.saveLocalStoreRecordIfUnchanged;
    (DataProvider as { saveLocalStoreRecordIfUnchanged: unknown }).saveLocalStoreRecordIfUnchanged = async () => { throw new Error('network'); };
    await flushRaw();
    (DataProvider as { saveLocalStoreRecordIfUnchanged: unknown }).saveLocalStoreRecordIfUnchanged = orig;
    // Мусор на месте: именно его читатель обязан не замечать. Прежний paging на
    // этом шаге давал «pages beyond N» — запись отказывалась читаться навсегда.
    const orphans = cloudKeys(d.id).filter(k => k.includes('@seg') && !baseKeys.has(k));
    expect(orphans.length, 'попытка A не оставила своих строк').toBeGreaterThan(0);

    // B дописывает и выгружается нормально.
    switchTo(b); at('09:32');
    await AIDialogueService.appendMessage(d.id, 'B', 'B');
    const rb = await flushRaw();
    expect(rb.failed, 'выгрузка B после осиротевших строк падает').toBe(0);
    const headAfter = cloud.get(rowKey('aiDialogues', d.id))!.payload as { head?: boolean, segments?: Array<{ key: string }> };
    expect(headAfter.head).toBe(true);

    const c = new Device(); switchTo(c); at('10:30');
    expect((await restoreAIDataFromCloud(UID)).failed, 'restore отказался от диалога').toBe(0);
    switchTo(a); at('10:31');
    expect((await flushRaw()).failed, 'A не может выгрузиться никогда').toBe(0);
    // И уборка: после удачной выгрузки в облаке не осталось ничего, чего head
    // не называет (ни осиротевших сегментов, ни страниц прежней копии).
    const named = new Set((cloud.get(rowKey('aiDialogues', d.id))!.payload as { segments: Array<{ key: string }> }).segments.map(s => s.key));
    for (const k of cloudKeys(d.id).filter(x => x.includes('@seg'))) expect(named.has(k), `мусор не убран: ${k}`).toBe(true);
    expect(cloudKeys(d.id).filter(k => k.includes('#')), 'страницы прежней копии остались').toEqual([]);
  });


  it('строка, которой head не называет, не ломает чтение и сносится следующей выгрузкой', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос ' + BIG + BIG + BIG }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();
    const headPayload = cloud.get(rowKey('aiDialogues', d.id))!.payload as { head: boolean, segments: Array<{ key: string, firstAt: number, updatedAt: number }> };
    expect(headPayload.head).toBe(true);
    expect(headPayload.segments.length).toBeGreaterThan(1);

    // Осиротевшая строка: тот же firstAt, чужой nonce, мусор внутри.
    const orphan = `${d.id}@seg${headPayload.segments[0]!.firstAt}-deadbeef`;
    cloud.set(rowKey('aiDialogues', orphan), {
      store: 'aiDialogues',
      key: orphan,
      payload: { seg: true, headKey: d.id, firstAt: headPayload.segments[0]!.firstAt, updatedAt: headPayload.segments[0]!.updatedAt, messages: 'мусор проигравшей попытки' },
      stamped_at: Date.now(),
    });

    const c = new Device(); switchTo(c); at('10:00');
    const r = await restoreAIDataFromCloud(UID);
    expect(r.failed, 'чтение отказалось из-за чужой строки').toBe(0);
    expect(heads(await localDialogue(d.id))).toEqual(['Вопрос', 'Ответ']);

    at('10:05');
    switchTo(a);
    await AIDialogueService.appendMessage(d.id, 'Новый вопрос', 'Новый ответ');
    await flush();
    // Выигравший CAS сносит всё, чего head не называет, — и мусор проигравшего
    // в том числе. Прежний paging на этом месте оставлял «pages beyond N».
    expect(cloud.has(rowKey('aiDialogues', orphan)), 'осиротевшая строка не убрана').toBe(false);
    const after = cloud.get(rowKey('aiDialogues', d.id))!.payload as { segments: Array<{ key: string }> };
    const named = new Set(after.segments.map(s => s.key));
    for (const k of cloudKeys(d.id).filter(x => x.includes('@seg'))) expect(named.has(k), `head не называет ${k}`).toBe(true);
  });

});
