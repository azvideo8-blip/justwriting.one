import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  LocalStoreSyncManager,
  getLocalStoreSyncSummary,
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
// пока scheduleStoreSync ждёт ответ IndexedDB.
let resolveGet!: (v: unknown) => void;
const fakeDb = {
  get: (_s: string, _k: string) => new Promise<unknown>(r => { resolveGet = r; }),
};
vi.mock('../../storage/localDb', () => ({
  getLocalDb: () => Promise.resolve(fakeDb),
}));

describe('R4-075: scheduleStoreDelete wins over an in-flight scheduleStoreSync read', () => {
  let del: ReturnType<typeof vi.spyOn>;
  let save: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    del = vi.spyOn(DataProvider, 'deleteLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
    save = vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
  });

  it('a delete landing between the read and resolve survives as a delete', async () => {
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreDelete('aiPortrait', 'p1');
    tab.scheduleStoreSync('aiPortrait', 'p1');
    await vi.waitFor(() => expect(typeof resolveGet).toBe('function'));
    // Синхронное удаление в окне незавершённого чтения.
    tab.scheduleStoreDelete('aiPortrait', 'p1');
    resolveGet({ id: 'p1', portrait: '# x', updatedAt: 1 });
    await new Promise(r => setTimeout(r, 0));

    // Обязательство «снести в облаке» на диске не тронуто.
    expect(getLocalStoreSyncSummary(USER).pending).toBe(1);

    const res = await tab.flushPending(true);
    expect(del).toHaveBeenCalledWith(USER, 'aiPortrait', 'p1');
    expect(save).not.toHaveBeenCalled();
    expect(res.synced).toBe(1);
    expect(getLocalStoreSyncSummary(USER).pending).toBe(0);
  });
});
