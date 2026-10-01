import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb, getLocalDbName } from '../../../core/storage/localDb';
import { takeAccountChangeNotice } from '../../../core/auth/accountReload';
import * as localDbModule from '../../../core/storage/localDb';

const USER = 'u_delete_wipe_fail_test';

const mockGetCurrentUser = vi.fn();
const mockReauthenticate = vi.fn();
const mockCallAi = vi.fn();
const mockSignOutUser = vi.fn();

vi.mock('../../../core/auth', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
  getCurrentUserId: () => mockGetCurrentUser()?.uid ?? null,
  reauthenticate: (...args: unknown[]) => mockReauthenticate(...args),
  signOutUser: (...args: unknown[]) => mockSignOutUser(...args),
}));

vi.mock('../../../core/ai/callAi', () => ({
  callAi: (...args: unknown[]) => mockCallAi(...args),
}));

describe('S-9: account deletion local wipe failure reporting & pending purge marker', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetCurrentUser.mockReturnValue({ uid: USER, email: 'user@example.com' });
    mockReauthenticate.mockResolvedValue(undefined);
    mockCallAi.mockResolvedValue({ success: true });
    mockSignOutUser.mockResolvedValue(undefined);
  });

  it('sets notice to account_deleted_wipe_failed (not account_deleted) on wipe failure', async () => {
    // Force wipe to fail
    vi.spyOn(localDbModule, 'clearAllLocalStores').mockRejectedValueOnce(new Error('IDB locked'));

    const { AuthService } = await import('../services/AuthService');

    await expect(AuthService.deleteAccount('secretPassword')).rejects.toThrow();

    const notice = takeAccountChangeNotice();
    expect(notice).not.toBe('account_deleted');
    expect(notice).toBe('account_deleted_wipe_failed');
    // S-32: сервер подтвердил удаление, локальная очистка не прошла — маркер
    // остаётся, чтобы следующий старт её доделал.
    expect(localStorage.getItem(`jw_pending_purge_${USER}`)).toBe('1');
  });

  it('removes justwriting-local-<uid> at boot when jw_pending_purge marker is set', async () => {
    const purgeUid = 'user_pending_s9';
    localStorage.setItem(`jw_pending_purge_${purgeUid}`, '1');

    const dbName = getLocalDbName(purgeUid);
    const userDb = await getLocalDb(purgeUid);
    await userDb.put('documents', {
      id: 'doc1',
      guestId: purgeUid,
      title: 'Pending purge doc',
      currentVersion: 1,
      totalWords: 5,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1,
      lastSessionAt: 1,
      tags: [],
    } as any);

    if (typeof indexedDB.databases === 'function') {
      const dbsBefore = await indexedDB.databases();
      expect(dbsBefore.some(db => db.name === dbName)).toBe(true);
    }

    // Call boot processor
    const { processPendingPurges } = await import('../../../core/storage/localDb');
    await processPendingPurges();

    if (typeof indexedDB.databases === 'function') {
      const dbsAfter = await indexedDB.databases();
      expect(dbsAfter.some(db => db.name === dbName)).toBe(false);
    }
    expect(localStorage.getItem(`jw_pending_purge_${purgeUid}`)).toBeNull();
  });
});
