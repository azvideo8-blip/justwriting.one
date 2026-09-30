import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  LocalStoreSyncManager,
  getLocalStoreSyncSummary,
  getPendingStoreUpserts,
  readPersistedDeletes,
} from '../LocalStoreSyncService';
import { DataProvider } from '../../data';

const USER = 'u_l4_race';

vi.mock('../../sync/cloudSyncEnabled', () => ({ cloudSyncEnabled: () => true }));
vi.mock('../../crypto/cryptoHelpers', async (orig) => ({
  ...(await orig<object>()),
  maybeEncrypt: async (x: unknown) => x,
  getEncryptionEnabled: () => false,
}));
vi.mock('../../auth', () => ({
  getCurrentUser: () => ({ uid: USER }),
  getCurrentUserId: () => USER,
}));

// R4-075: чтение записи управляется тестом — удаление должно успеть встать,
// пока scheduleStoreSync ждёт ответ IndexedDB. После ответа (nextGet задан)
// следующие чтения отвечают сразу — иначе мутация краснела бы по таймауту.
let resolveGet: ((v: unknown) => void) | null = null;
let nextGet: unknown = undefined;
const fakeDb = {
  get: (_s: string, _k: string) => nextGet !== undefined
    ? Promise.resolve(nextGet)
    : new Promise<unknown>(r => { resolveGet = r; }),
};
const pendingOf = (tab: LocalStoreSyncManager) =>
  (tab as unknown as { pending: Map<string, { isDelete?: boolean }> }).pending;
vi.mock('../../storage/localDb', () => ({
  getLocalDb: () => Promise.resolve(fakeDb),
}));

describe('R4-075: scheduleStoreDelete wins over an in-flight scheduleStoreSync read', () => {
  let del: ReturnType<typeof vi.spyOn>;
  let save: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    resolveGet = null;
    nextGet = undefined;
    del = vi.spyOn(DataProvider, 'deleteLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
    save = vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
  });

  it('a delete landing between the read and resolve survives as a delete', async () => {
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreDelete('aiPortrait', 'p1');
    tab.scheduleStoreSync('aiPortrait', 'p1');
    await vi.waitFor(() => expect(resolveGet).not.toBeNull());
    // Синхронное удаление в окне незавершённого чтения.
    tab.scheduleStoreDelete('aiPortrait', 'p1');
    nextGet = { id: 'p1', portrait: '# x', updatedAt: 1 };
    resolveGet!(nextGet);
    await new Promise(r => setTimeout(r, 0));

    // Обязательство «снести в облаке» на диске не тронуто, загрузки нет.
    expect(readPersistedDeletes()).toEqual([{ uid: USER, store: 'aiPortrait', key: 'p1' }]);
    expect(getPendingStoreUpserts(USER)).toEqual([]);
    expect(pendingOf(tab).get('aiPortrait:p1')?.isDelete).toBe(true);

    const res = await tab.flushPending(true);
    expect(del).toHaveBeenCalledWith(USER, 'aiPortrait', 'p1');
    expect(save).not.toHaveBeenCalled();
    expect(res.synced).toBe(1);
    expect(getLocalStoreSyncSummary(USER).pending).toBe(0);
  });
});

// M-10: страж сравнивал саму запись очереди, а её меняет и flush (pending.clear).
// Удаление уехало в окне чтения, запись создана заново — её upsert терялся навсегда.
describe('M-10: a flush inside the read window does not drop the re-created record', () => {
  beforeEach(() => {
    localStorage.clear();
    resolveGet = null;
    nextGet = undefined;
  });

  it('re-created record after delete reaches the cloud', async () => {
    const del = vi.spyOn(DataProvider, 'deleteLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
    const save = vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
    if (DataProvider.deleteLocalStorePagedRecords) vi.spyOn(DataProvider, 'deleteLocalStorePagedRecords').mockReset().mockResolvedValue(undefined as never);
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreDelete('aiPortrait', 'p1');
    tab.scheduleStoreSync('aiPortrait', 'p1');
    await vi.waitFor(() => expect(resolveGet).not.toBeNull());
    // Дебаунс сработал внутри окна чтения: удаление уехало, очередь очищена.
    await tab.flushPending(true);
    expect(del).toHaveBeenCalledTimes(1);
    nextGet = { id: 'p1', portrait: '# new', updatedAt: 2 };
    resolveGet!(nextGet);
    await new Promise(r => setTimeout(r, 0));

    expect(getPendingStoreUpserts(USER)).toEqual([{ uid: USER, store: 'aiPortrait', key: 'p1' }]);
    expect(getLocalStoreSyncSummary(USER).pending).toBe(1);
    await tab.flushPending(true);
    expect(save).toHaveBeenCalledWith(USER, 'aiPortrait', 'p1', expect.anything());
    expect(getLocalStoreSyncSummary(USER).pending).toBe(0);
  });
});
