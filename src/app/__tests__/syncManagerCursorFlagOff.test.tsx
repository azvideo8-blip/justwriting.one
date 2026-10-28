import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

const checkAndSyncCursor = vi.fn(async (_uid?: string) => ({ checked: true, synced: true, serverCursor: '2026-09-19T12:00:00.000Z' }));
const pullNotes = vi.fn(async () => ({ downloaded: 0, reconciled: 0, skipped: 0, corrupted: 0, failed: 0, documentsRev: 0, versionsRev: 0 }));

// S1-7: выключенный флаг возвращает старую проверку курсора на видимости.
vi.mock('../../core/sync/syncFlags', () => ({ syncPullByRevEnabled: async () => false }));
vi.mock('../../core/sync/changeCursor', () => ({
  checkAndSyncCursor: (uid: string) => checkAndSyncCursor(uid),
}));
vi.mock('../../core/services/SyncService', () => ({
  SyncService: {
    pullNotes,
    syncPending: vi.fn(async () => undefined),
    reviveLockedTasks: vi.fn(async () => 0),
  },
}));
vi.mock('../../shared/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_cursor_off' } }),
}));

const { SyncManager } = await import('../AppProviders');

describe('S1-7: visibility with SYNC_PULL_BY_REV=false', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_cursor_off'), 'true');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('runs checkAndSyncCursor, not pullNotes, on visibilitychange', async () => {
    render(<SyncManager />);
    await new Promise(r => setTimeout(r, 0));
    vi.clearAllMocks();

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 0));

    expect(checkAndSyncCursor).toHaveBeenCalledWith('u_cursor_off');
    expect(pullNotes).not.toHaveBeenCalled();
  });
});
