import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

const checkAndSyncCursor = vi.fn(async (_uid?: string) => ({ checked: true, synced: true, serverCursor: '2026-09-19T12:00:00.000Z' }));
const pullNotes = vi.fn(async () => ({ downloaded: 0, reconciled: 0, skipped: 0, corrupted: 0, failed: 0, documentsRev: 0, versionsRev: 0 }));

// RP-3: флаг с сервера; здесь проверяется новый путь — флаг включён.
vi.mock('../../core/sync/syncFlags', () => ({ syncPullByRevEnabled: async () => true }));
vi.mock('../../core/sync/changeCursor', () => ({
  checkAndSyncCursor: (uid: string) => checkAndSyncCursor(uid),
}));

vi.mock('../../core/services/SyncService', () => ({
  SyncService: {
    pullNotes,
    isRevPullUnavailable: () => false,
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

describe('S1-7: SyncManager visibilitychange trigger with SYNC_PULL_BY_REV', () => {
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
    // Вход сам по себе зовёт pullNotes (AppProviders); ждём его и обнуляем,
    // чтобы проверять только событие видимости.
    await new Promise((r) => setTimeout(r, 0));
    vi.clearAllMocks();

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));

    expect(checkAndSyncCursor).not.toHaveBeenCalled();
    expect(pullNotes).not.toHaveBeenCalled();
  });

  it('visibilitychange fired while document.hidden is false — pullNotes runs, cursor check does not', async () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });

    render(<SyncManager />);
    await new Promise((r) => setTimeout(r, 0));
    vi.clearAllMocks();

    document.dispatchEvent(new Event('visibilitychange'));
    // Два динамических импорта до вызова: ждём сам вызов, а не кадр.
    await vi.waitFor(() => expect(pullNotes).toHaveBeenCalledWith('u_cursor_test'));
    expect(checkAndSyncCursor).not.toHaveBeenCalled();
  });

  it('does not run cursor check if autoSync is disabled', async () => {
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_cursor_test'), 'false');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });

    render(<SyncManager />);
    await new Promise((r) => setTimeout(r, 0));
    vi.clearAllMocks();
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 0));

    expect(checkAndSyncCursor).not.toHaveBeenCalled();
    expect(pullNotes).not.toHaveBeenCalled();
  });
});
