import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../core/storage/localDb';

const USER = 'u_delete_acc_test';

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

describe('Area 1: deleteAccount must force wipe even with unsynced local data', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockReturnValue({ uid: USER, email: 'user@example.com' });
    mockReauthenticate.mockResolvedValue(undefined);
    mockCallAi.mockResolvedValue({ success: true });
    mockSignOutUser.mockResolvedValue(undefined);

    const db = await getLocalDb();
    await db.clear('documents');
  });

  it('FAILING TEST: deleteAccount fails to wipe when unsynced data is present', async () => {
    const db = await getLocalDb();
    // Seed an unsynced note (localOnly: true)
    await db.put('documents', {
      id: 'unsynced_note',
      uuid: 'uuid_unsynced',
      guestId: USER,
      title: 'Несинхронизированная заметка',
      currentVersion: 1,
      totalWords: 10,
      totalDuration: 0,
      sessionsCount: 1,
      firstSessionAt: 1,
      lastSessionAt: 1,
      tags: [],
      localOnly: true,
    } as any);

    const { AuthService } = await import('../services/AuthService');

    // Currently: this rejects with UnsyncedLocalDataError because deleteAccount
    // called signOut({ clearLocalData: true }) without force: true!
    await AuthService.deleteAccount('secretPassword');

    // Expected: the server account is deleted AND local data is wiped!
    const freshDb = await getLocalDb(USER);
    const remaining = await freshDb.getAll('documents');
    expect(remaining).toHaveLength(0);
  });

  it('DEEP-14: deleteAccount completely deletes the user IndexedDB database file', async () => {
    const { getLocalDbName } = await import('../../../core/storage/localDb');
    const userDbName = getLocalDbName(USER);
    const userDb = await getLocalDb(USER);
    await userDb.put('documents', {
      id: 'doc_to_delete',
      guestId: USER,
      title: 'Doc to delete',
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
      expect(dbsBefore.some(db => db.name === userDbName)).toBe(true);
    }

    const { AuthService } = await import('../services/AuthService');
    await AuthService.deleteAccount('secretPassword');

    if (typeof indexedDB.databases === 'function') {
      const dbsAfter = await indexedDB.databases();
      expect(dbsAfter.some(db => db.name === userDbName)).toBe(false);
    }
  });
});
