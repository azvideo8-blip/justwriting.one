import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  LocalStoreSyncManager,
  _resetReportedForTests,
} from '../LocalStoreSyncService';
import { DataProvider } from '../../data';
import { getLocalDb } from '../../storage/localDb';
import { reportError } from '../../../shared/errors/reportError';

const USER = 'u_f2_journal';
const DELETES_KEY = 'ai_sync_pending_deletes';

vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
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

describe('F-2: a corrupt delete journal heals instead of stopping uploads forever', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    _resetReportedForTests?.();
    const db = await getLocalDb();
    await db.clear('aiPortrait');
    await db.put('aiPortrait' as never, { id: 'p1', portrait: '# x', updatedAt: 1000, generatedAtDelta: 0 } as never);
    vi.spyOn(DataProvider, 'saveLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
    if (DataProvider.deleteLocalStorePagedRecords) {
      vi.spyOn(DataProvider, 'deleteLocalStorePagedRecords').mockReset().mockResolvedValue(undefined as never);
    }
    vi.spyOn(DataProvider, 'deleteLocalStoreRecord').mockReset().mockResolvedValue(undefined as never);
    vi.mocked(reportError).mockClear();
  });

  it('heals invalid JSON on first drain (holding back upsert) and resumes upsert on second drain', async () => {
    const rawCorrupt = '{invalid json string';
    localStorage.setItem(DELETES_KEY, rawCorrupt);

    // Stage an upsert
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    await new Promise(r => setTimeout(r, 50));

    // First drain: no upsert, backup key holds the raw string, journal is [], one reportError
    const res1 = await tab.flushPending(true);
    expect(res1.synced).toBe(0);
    expect(DataProvider.saveLocalStoreRecord).not.toHaveBeenCalled();

    // Verify backup key holds the raw string
    const backupKeys = Object.keys(localStorage).filter(k => k.startsWith('ai_sync_pending_deletes.corrupt.'));
    expect(backupKeys).toHaveLength(1);
    expect(localStorage.getItem(backupKeys[0])).toBe(rawCorrupt);

    // Verify journal is now '[]'
    expect(localStorage.getItem(DELETES_KEY)).toBe('[]');

    // Exactly one reportError
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        action: 'flushPending_deleteJournalUnknown',
        userId: USER,
        rawLength: rawCorrupt.length,
        salvaged: 0,
        dropped: 0,
      }),
      'warning',
    );

    // Second drain: the upsert goes out, no new reportError
    const res2 = await tab.flushPending(true);
    expect(res2.synced).toBe(1);
    expect(DataProvider.saveLocalStoreRecord).toHaveBeenCalledWith(USER, 'aiPortrait', 'p1', expect.anything());

    // No new reportError
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('salvages valid items from an array with malformed elements and executes cloud delete', async () => {
    const validItem = { uid: USER, store: 'aiPortrait', key: 'p_to_delete' };
    const malformedItem = { uid: 12345, missing: 'fields' };
    const rawArray = JSON.stringify([validItem, malformedItem]);
    localStorage.setItem(DELETES_KEY, rawArray);

    const tab = new LocalStoreSyncManager();

    // First drain triggers healing
    await tab.flushPending(true);

    // After healing, journal holds the valid item only
    const stored = JSON.parse(localStorage.getItem(DELETES_KEY) || '[]');
    expect(stored).toEqual([validItem]);

    // Backup holds the raw string
    const backupKeys = Object.keys(localStorage).filter(k => k.startsWith('ai_sync_pending_deletes.corrupt.'));
    expect(backupKeys).toHaveLength(1);
    expect(localStorage.getItem(backupKeys[0])).toBe(rawArray);

    // Second drain executes the cloud delete for the salvaged item
    await tab.flushPending(true);
    expect(DataProvider.deleteLocalStoreRecord).toHaveBeenCalledWith(USER, 'aiPortrait', 'p_to_delete');

    // And after finished delete, forgetPersistedDelete cleans it up
    expect(JSON.parse(localStorage.getItem(DELETES_KEY) || '[]')).toEqual([]);
  });

  it('reports at most once per page load when localStorage.getItem throws', async () => {
    // Stage an upsert first
    const tab = new LocalStoreSyncManager();
    tab.scheduleStoreSync('aiPortrait', 'p1');
    await new Promise(r => setTimeout(r, 50));

    // Make getItem throw on every call
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: localStorage is disabled');
    });

    // Drain 1
    const r1 = await tab.flushPending(true);
    expect(r1.synced).toBe(0);
    expect(DataProvider.saveLocalStoreRecord).not.toHaveBeenCalled();

    // Drain 2
    const r2 = await tab.flushPending(true);
    expect(r2.synced).toBe(0);
    expect(DataProvider.saveLocalStoreRecord).not.toHaveBeenCalled();

    // Drain 3
    const r3 = await tab.flushPending(true);
    expect(r3.synced).toBe(0);
    expect(DataProvider.saveLocalStoreRecord).not.toHaveBeenCalled();

    // Exactly one reportError across all 3 drains
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'flushPending_deleteJournalUnknown', userId: USER }),
      'warning',
    );
  });
});
