import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, resetDbInstance } from '../../storage/localDb';
import type { AIDialogue } from '../../storage/localDb';
import { restoreAIDataFromCloud } from '../../../features/ai/services/AIRestoreService';

// V-4.1 (ревью T-9, repro zzOldClientResurrect): устройство с 0.9.29, у которого
// ещё лежит диалог, удалённый в другом месте, при следующей выгрузке перезатирает
// надгробие ЖИВОЙ строкой прежнего формата. Старый клиент починить нельзя —
// значит новый читатель обязан вернуть надгробие в облако сразу, в этом же проходе
// забора. До правки вызывался только debounced scheduleStoreSync, и всё это время
// (до следующего flush'а) свежее устройство показывало диалог, которого нет.
//
// Тест НЕ поднимает таймеры и НЕ вызывает flushPending сам: если выгрузка не
// произошла внутри restoreAIDataFromCloud — её не произошло вовсе.

const UID = 'u_v4_resurrect';
const ID = 'dlg_v4_1';

type Row = { store: string; key: string; payload: Record<string, unknown>; stamped_at?: unknown };
const cloud = new Map<string, Row>();
const rowKey = (store: string, key: string) => `${store}:${key}`;

const saves: string[] = [];

vi.mock('../../data', async () => {
  const actual = await vi.importActual<typeof import('../../data')>('../../data');
  return {
    ...actual,
    DataProvider: {
      getLocalStoreRecordsByKeyPrefix: async () => [],
      deleteLocalStoreRecordsByKeys: async () => {},
      deleteLocalStorePagedRecords: async () => {},
      deleteLocalStoreRecord: async (store: string, key: string) => { cloud.delete(rowKey('aiDialogues', key as string)); void store; },
      getUserSummaries: async () => [],
      getUserEmbeddingsPaginated: async () => ({ items: [], nextCursorId: null, readCount: 0 }),
      getSummariesLastSync: async () => null,
      getLocalStoreRecords: async (_uid: string, store?: string) =>
        [...cloud.values()]
          .filter(r => !store || r.store === store)
          .sort((a, b) => a.store.localeCompare(b.store) || a.key.localeCompare(b.key))
          .map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>)),
      getLocalStoreRecord: async (_uid: string, store: string, key: string) => {
        const r = cloud.get(rowKey(store, key));
        return r ? actual.rowToLocalStoreRecord(r as Record<string, unknown>) : null;
      },
      getLocalStoreRecordPages: async (_uid: string, store: string, key: string) =>
        [...cloud.values()]
          .filter(r => r.store === store && r.key.startsWith(`${key}#`))
          .map(r => actual.rowToLocalStoreRecord(r as Record<string, unknown>)),
      saveLocalStoreRecord: async (_uid: string, store: string, key: string, payload: Record<string, unknown>) => {
        saves.push(`${store}:${key}`);
        cloud.set(rowKey(store, key), { store, key, payload, stamped_at: Date.now() });
      },
      saveLocalStoreRecordPages: async (_uid: string, store: string, pages: Array<{ key: string; payload: Record<string, unknown> }>) => {
        for (const p of pages) { saves.push(`${store}:${p.key}`); cloud.set(rowKey(store, p.key), { store, key: p.key, payload: p.payload, stamped_at: Date.now() }); }
      },
      saveLocalStoreRecordIfUnchanged: async (_uid: string, store: string, key: string, payload: Record<string, unknown>, expected: number | null) => {
        const cur = cloud.get(rowKey(store, key));
        if (expected === null ? cur !== undefined : cur?.payload.updatedAt !== expected) return false;
        saves.push(`${store}:${key}`);
        cloud.set(rowKey(store, key), { store, key, payload, stamped_at: Date.now() });
        return true;
      },
    },
  };
});

vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: UID, email: 'u@example.com' }),
  getCurrentUserId: () => UID,
}));
// Синхронизация включена: иначе flushPending имеет право ничего не выгружать,
// и тест проверял бы не то.
vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', () => ({
  getEncryptionEnabled: () => false,
  maybeDecrypt: async (doc: Record<string, unknown>) => doc,
  maybeEncrypt: async (doc: Record<string, unknown>) => doc,
}));
vi.mock('../../crypto/encrypt', () => ({ getSessionKey: () => null }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const base: AIDialogue = {
  id: ID,
  title: 'Диалог',
  personaId: 'coach',
  personaName: 'Коуч',
  personaEmoji: '🎯',
  createdAt: 1000,
  updatedAt: 2000,
  messages: [
    { id: 'm1', role: 'user', content: 'Вопрос', createdAt: 1000 },
    { id: 'm2', role: 'assistant', content: 'Ответ', createdAt: 1001 },
  ],
};

function tombstone(deletedAt: number): AIDialogue {
  return { ...base, deletedAt } as AIDialogue;
}

/** Строка, которую 0.9.29 выгружает поверх чужого удаления: одиночная, живая. */
function setOldClientLiveRow(updatedAt: number): void {
  cloud.set(rowKey('aiDialogues', ID), {
    store: 'aiDialogues',
    key: ID,
    payload: { data: JSON.stringify(base), updatedAt },
  });
}

describe('V-4.1: надгробие возвращается в облако в том же проходе забора', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloud.clear();
    saves.length = 0;
    localStorage.clear();
    resetDbInstance();
  });

  afterEach(() => {
    resetDbInstance();
  });

  it('живая old-format строка поверх локального надгробия — надгробие уезжает сразу', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiDialogues', tombstone(Date.now()) as never);
    setOldClientLiveRow(Date.now() + 5000);

    await restoreAIDataFromCloud(UID);

    const row = cloud.get(rowKey('aiDialogues', ID));
    expect(row, 'облачная строка должна быть перезаписана в этом же проходе').toBeDefined();
    // R-3: надгробие всегда уходит head’ом — 0.9.29 читает любую строку с `data`.
    expect(row!.payload.head).toBe(true);
    expect(row!.payload.deletedAt).toBeTypeOf('number');
    expect(saves).toContain(`aiDialogues:${ID}`);

    // Локальное надгробие не воскресло.
    const local = await db.get('aiDialogues', ID);
    expect(local && (local as AIDialogue).deletedAt).toBeTypeOf('number');
  });

  it('обычный союз (локальная и облачная живые копии) в этом же проходе не выгружается', async () => {
    // Негативный контроль: немедленный flush — только для случая воскрешения,
    // остальные расхождения по-прежнему ждут штатной выгрузки.
    const db = await getLocalDb(UID);
    const localLive: AIDialogue = { ...base, messages: [...base.messages, { id: 'm3', role: 'user', content: 'Ход локально', createdAt: 1002 }] };
    await db.put('aiDialogues', localLive as never);
    setOldClientLiveRow(Date.now() + 5000);

    await restoreAIDataFromCloud(UID);

    expect(saves).toEqual([]);
    expect(cloud.get(rowKey('aiDialogues', ID))!.payload.head).toBeUndefined();
  });

  it('живая строка поверх живого диалога не считается воскрешением', async () => {
    const db = await getLocalDb(UID);
    await db.put('aiDialogues', { ...base, deletedAt: undefined } as never);
    setOldClientLiveRow(Date.now() + 5000);

    await restoreAIDataFromCloud(UID);

    expect(saves).toEqual([]);
  });
});
