import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

const checkAndSyncCursor = vi.fn(async (_uid?: string) => ({ checked: true, synced: true, serverCursor: '2026-09-19T12:00:00.000Z' }));

vi.mock('../../core/sync/changeCursor', () => ({
  checkAndSyncCursor: (uid: string) => checkAndSyncCursor(uid),
}));

vi.mock('../../core/services/SyncService', () => ({
  SyncService: {
    downloadAllFromCloud: vi.fn(async () => ({ downloaded: 0, skipped: 0, failed: 0 })),
    syncPending: vi.fn(async () => undefined),
    reviveLockedTasks: vi.fn(async () => 0),
  },
}));

vi.mock('../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_cursor_test' } }),
}));

const { SyncManager } = await import('../AppProviders');

describe('SYNC-CURSOR-2: SyncManager visibilitychange trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_cursor_test'), 'true');
  });

  it('visibilitychange fired while document.hidden — no check runs', async () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });

    render(<SyncManager />);
    expect(checkAndSyncCursor).not.toHaveBeenCalled();

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));

    expect(checkAndSyncCursor).not.toHaveBeenCalled();
  });

  it('visibilitychange fired while document.hidden is false — check runs', async () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });

    render(<SyncManager />);
    expect(checkAndSyncCursor).not.toHaveBeenCalled();

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));

    expect(checkAndSyncCursor).toHaveBeenCalledWith('u_cursor_test');
  });

  it('does not run cursor check if autoSync is disabled', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_cursor_test'), 'false');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });

    render(<SyncManager />);
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));

    expect(checkAndSyncCursor).not.toHaveBeenCalled();
  });
});
