import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { TOMBSTONE_TTL_MS } from '../../storage/dialogueMerge';
import { LocalStoreSyncService } from '../LocalStoreSyncService';
import { AIDialogueService } from '../../../features/ai/services/AIDialogueService';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';

// S-58 (стенд, сценарий 15): A удаляет диалог, B, ещё держа его, дописывает и
// выгружает, A забирает — и диалог возвращается. Удаление побеждает: вместо
// стирания строки пишется надгробие, которое слияние предпочитает любым ходам.

const UID = 'u_s58';
type Row = { store: string; key: string; payload: Record<string, unknown> };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;
const cloudDeletes = vi.fn();
const push = vi.hoisted(() => ({ empty: false }));

vi.mock('../../data', () => ({
  DataProvider: {
    syncPush: async (items: unknown[]) => (push.empty ? [] : items.map(() => ({ status: 'ok' as const }))),
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
    getLocalStoreRecordPages: async () => [],
    saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => { cloud.set(rowKey(store, key), { store, key, payload }); },
    saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
      const cur = cloud.get(rowKey(store, key));
      if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
      cloud.set(rowKey(store, key), { store, key, payload });
      return true;
    },
    deleteLocalStorePagedRecords: async () => {},
    deleteLocalStoreRecord: async (_uid: string, store: string, key: string) => { cloudDeletes(store, key); cloud.delete(rowKey(store, key)); },
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
vi.mock('../../auth', () => ({ getCurrentUser: () => ({ uid: UID, email: 'someone@example.com' }), getCurrentUserId: () => UID }));

class Device {
  readonly factory = new IDBFactory();
  readonly storage = new Map<string, string>();
}
let currentDevice: Device | null = null;
function switchTo(dev: Device): void {
  if (currentDevice === dev) return;
  if (currentDevice) {
    currentDevice.storage.clear();
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; currentDevice.storage.set(k, localStorage.getItem(k)!); }
  }
  localStorage.clear();
  for (const [k, v] of dev.storage) localStorage.setItem(k, v);
  resetDbInstance();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = dev.factory;
  currentDevice = dev;
}

const T = (hhmm: string) => Date.parse(`2026-10-02T${hhmm}:00+05:00`);
const at = (hhmm: string) => vi.setSystemTime(T(hhmm));
async function flush(): Promise<void> {
  const r = await LocalStoreSyncService.flushPending(true);
  expect(r.failed, 'выгрузка упала').toBe(0);
}
const listedIds = async () => (await AIDialogueService.list({ includeArchived: true })).map(d => d.id);
async function raw(id: string): Promise<AIDialogue | undefined> { return (await getLocalDb()).get('aiDialogues', id); }

async function shared(a: Device, b: Device): Promise<AIDialogue> {
  switchTo(a);
  at('09:00');
  const d = await AIDialogueService.create({
    title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
    messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
  });
  await flush();
  switchTo(b);
  at('09:01');
  await restoreAIDataFromCloud(UID);
  expect(await listedIds()).toEqual([d.id]);
  return d;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  cloud.clear();
  cloudDeletes.mockClear();
  push.empty = false;
  currentDevice = null;
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('S-58: deleting a dialogue survives a concurrent append on another device', () => {
  it('пустой ответ sync_push на надгробие — сбой выгрузки, а не «удалено»', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }],
    });
    await AIDialogueService.delete(d.id);
    await flush();
    vi.setSystemTime(T('09:00') + TOMBSTONE_TTL_MS + 24 * 60 * 60 * 1000);
    await listedIds();
    push.empty = true;
    const r = await LocalStoreSyncService.flushPending(true);
    expect(r.failed, 'пустой ответ засчитан как надгробие').toBeGreaterThan(0);
    expect(cloudDeletes).not.toHaveBeenCalledWith('aiDialogues', d.id);
  });

  it('scenario 15: A deletes, B appends and uploads, A pulls — the dialogue stays deleted everywhere', async () => {
    const a = new Device();
    const b = new Device();
    const d = await shared(a, b);

    switchTo(a);
    at('09:30');
    await AIDialogueService.delete(d.id);
    expect(await listedIds()).toEqual([]);
    await flush();

    switchTo(b);
    at('10:00');
    await AIDialogueService.appendMessage(d.id, 'Вопрос с B', 'Ответ с B');
    await flush();
    expect(await listedIds(), 'B всё ещё показывает удалённый диалог после выгрузки').toEqual([]);

    switchTo(a);
    at('10:05');
    await restoreAIDataFromCloud(UID);
    expect(await listedIds(), 'удалённый диалог вернулся на A').toEqual([]);
    expect(await AIDialogueService.get(d.id)).toBeUndefined();

    const fresh = new Device();
    switchTo(fresh);
    at('10:10');
    await restoreAIDataFromCloud(UID);
    expect(await listedIds(), 'новое устройство восстановило удалённый диалог').toEqual([]);
  });

  it('B pulling the tombstone drops its local copy; a later append on B does not revive it', async () => {
    const a = new Device();
    const b = new Device();
    const d = await shared(a, b);

    switchTo(a);
    at('09:30');
    await AIDialogueService.delete(d.id);
    await flush();

    switchTo(b);
    at('09:40');
    await restoreAIDataFromCloud(UID);
    expect(await listedIds()).toEqual([]);
    await AIDialogueService.appendMessage(d.id, 'Поздний вопрос', 'Поздний ответ');
    expect((await raw(d.id))?.messages ?? [], 'ход дописан в надгробие').toEqual([]);
  });

  it('a tombstone older than 90 days is removed locally and in the cloud by list()', async () => {
    const a = new Device();
    switchTo(a);
    at('09:00');
    const d = await AIDialogueService.create({
      title: 'Разговор', personaId: 'coach', personaName: 'Коуч', personaEmoji: '🎯',
      messages: [{ role: 'user', content: 'Вопрос' }, { role: 'assistant', content: 'Ответ' }],
    });
    await AIDialogueService.delete(d.id);
    await flush();
    expect(cloud.has(rowKey('aiDialogues', d.id))).toBe(true);

    vi.setSystemTime(T('09:00') + TOMBSTONE_TTL_MS + 24 * 60 * 60 * 1000);
    expect(await listedIds()).toEqual([]);
    expect(await raw(d.id)).toBeUndefined();
    await flush();
    expect(cloudDeletes).toHaveBeenCalledWith('aiDialogues', d.id);
    expect(cloud.has(rowKey('aiDialogues', d.id))).toBe(false);
  });
});
