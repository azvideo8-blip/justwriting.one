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

type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
let onCloudRead: (() => void) | null = null;
const casCalls = vi.fn();

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
    deleteLocalStoreStalePages: async (_uid: string, store: string, key: string, keepStamp: number, keepNonce?: string) => {
      // как провайдер: победитель оставляет страницы своей попытки (M-2),
      // без метки — прежняя гранулярность по отметке.
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
const cloudKeys = (id: string) => [...cloud.values()].filter(r => r.key === id || r.key.startsWith(`${id}#`)).map(r => r.key).sort();

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

  it('P6: осиротевшие страницы неудавшейся попытки не коверают чтение и не мешают победителю', async () => {
    const x = new Device(); const a = new Device(); const b = new Device();
    switchTo(x); at('10:00');
    const d = await AIDialogueService.create({ title: 'Р', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Общий вопрос ' + BIG + BIG + BIG }, { role: 'assistant', content: 'Общий ответ' }] });
    await flush();
    for (const dev of [a, b]) { switchTo(dev); at('09:30'); await restoreAIDataFromCloud(UID); }
    // A (clock behind): big append, pages go up, the manifest request fails
    switchTo(a); at('09:31');
    await AIDialogueService.appendMessage(d.id, 'A ' + BIG, 'A ' + BIG, BIG);
    const { DataProvider } = await import('../../data');
    const orig = DataProvider.saveLocalStoreRecordIfUnchanged;
    (DataProvider as { saveLocalStoreRecordIfUnchanged: unknown }).saveLocalStoreRecordIfUnchanged = async () => { throw new Error('network'); };
    await flushRaw();
    (DataProvider as { saveLocalStoreRecordIfUnchanged: unknown }).saveLocalStoreRecordIfUnchanged = orig;
    const afterA = cloudKeys(d.id);
    // Проигравшая попытка оставила в облаке свои страницы — их и должен игнорировать читатель.
    // B (clock behind too): smaller big append, uploads fine
    switchTo(b); at('09:32');
    await AIDialogueService.appendMessage(d.id, 'B', 'B');
    const rb = await flushRaw();
    expect(rb.failed, "выгрузка B после осиротевших страниц падает").toBe(0);
    const afterB = cloudKeys(d.id).map(k => k.slice(36));
    expect(afterA.filter(k => k.slice(36) !== "").length).toBeGreaterThan(1);
    const manifest = cloud.get(rowKey('aiDialogues', d.id))!.payload;
    // M-2: в облаке остались страницы победителя — одна попытка, ровно totalPages
    // штук, все под меткой из манифеста. Прежнее «key#<stamp>» давало лишнюю
    // страницу от проигравшего и «pages beyond N» при чтении.
    const nonce = String(manifest.nonce);
    expect(nonce).toMatch(/^[0-9a-f]{8}$/);
    const pages = afterB.filter(k => k.startsWith('#'));
    expect(pages.every(k => k.startsWith('#' + String(manifest.updatedAt) + '#' + nonce + '#'))).toBe(true);
    expect(pages).toHaveLength(Number(manifest.totalPages));
    const c = new Device(); switchTo(c); at('10:30');
    const r = await restoreAIDataFromCloud(UID);
    expect(r.failed, 'restore refused the dialogue').toBe(0);
    switchTo(a); at('10:31');
    expect((await flushRaw()).failed, 'A can never upload again').toBe(0);
  });


  it('манифест называет попытку, а чужие страницы той же отметки не читаются', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос ' + BIG + BIG + BIG }, { role: 'assistant', content: 'Ответ' }],
    });
    await flush();
    const manifest = cloud.get(rowKey('aiDialogues', d.id))!.payload;
    const stamp = Number(manifest.updatedAt);
    const nonce = String(manifest.nonce);
    expect(manifest.totalPages).toBeGreaterThan(1);

    // Осиротевшая страница проигравшей попытки: та же отметка, другой nonce.
    const orphan = d.id + "#" + stamp + "#deadbeef#0";
    cloud.set(rowKey('aiDialogues', orphan), {
      store: 'aiDialogues',
      key: orphan,
      payload: { data: 'мусор проигравшей попытки', updatedAt: stamp, page: 0, totalPages: manifest.totalPages, nonce: 'deadbeef' },
    });

    const c = new Device(); switchTo(c); at('10:00');
    const r = await restoreAIDataFromCloud(UID);
    expect(r.failed, 'чтение отказалось из-за чужой страницы той же отметки').toBe(0);
    expect(heads(await localDialogue(d.id))).toEqual(['Вопрос', 'Ответ']);

    // Чистка победителя не трогает его страницы, а проигравший сносит только свои.
    const winnerKeys = cloudKeys(d.id).filter(k => k.includes(nonce));
    expect(winnerKeys.length).toBe(Number(manifest.totalPages));
    at('10:05');
    switchTo(a);
    await AIDialogueService.appendMessage(d.id, 'Новый вопрос', 'Новый ответ');
    await flush();
    const loserNonce = String(cloud.get(rowKey('aiDialogues', d.id))!.payload.nonce);
    expect(loserNonce).not.toBe(nonce);
    expect(cloudKeys(d.id).some(k => k.includes('deadbeef'))).toBe(false);
  });

});
