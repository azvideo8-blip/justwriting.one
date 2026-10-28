import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

const checkAndSyncCursor = vi.fn(async (_uid?: string) => ({ checked: true, synced: false, serverCursor: null }));
const pullNotes = vi.fn(async () => ({ downloaded: 0, reconciled: 0, skipped: 0, corrupted: 0, failed: 0, documentsRev: 0, versionsRev: 0, deferred: 0 }));
let revUnavailable = true;

// S1-13: флаг включён, но сервер этой сессии ответил 42703 (0045 ещё нет).
// Видимость обязана идти старой проверкой курсора (два limit 1), а не полным
// проходом через pullNotes — иначе неделю+ до 0045 каждый возврат во вкладку
// у всех — полный getUserDocuments.
// RP-3: флаг с сервера; здесь проверяется новый путь — флаг включён.
vi.mock('../../core/sync/syncFlags', () => ({ syncPullByRevEnabled: async () => true }));
vi.mock('../../core/sync/changeCursor', () => ({
  checkAndSyncCursor: (uid: string) => checkAndSyncCursor(uid),
}));
vi.mock('../../core/services/SyncService', () => ({
  SyncService: {
    pullNotes,
    isRevPullUnavailable: () => revUnavailable,
    syncPending: vi.fn(async () => undefined),
    reviveLockedTasks: vi.fn(async () => 0),
  },
}));
vi.mock('../../shared/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_rev_unavailable' } }),
}));

const { SyncManager } = await import('../AppProviders');

describe('S1-13: visibility while the server has no rev column', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_rev_unavailable'), 'true');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('runs checkAndSyncCursor, not pullNotes, once the session learned 42703', async () => {
    revUnavailable = true;
    render(<SyncManager />);
    await new Promise(r => setTimeout(r, 0));
    vi.clearAllMocks();

    document.dispatchEvent(new Event('visibilitychange'));
    // Два динамических импорта до вызова: ждём сам вызов, а не кадр.
    await vi.waitFor(() => expect(checkAndSyncCursor).toHaveBeenCalledWith('u_rev_unavailable'));
    expect(pullNotes).not.toHaveBeenCalled();
  });

  it('still pulls by rev while the server knows the column', async () => {
    revUnavailable = false;
    render(<SyncManager />);
    await new Promise(r => setTimeout(r, 0));
    vi.clearAllMocks();

    document.dispatchEvent(new Event('visibilitychange'));
    // Два динамических импорта до вызова: ждём сам вызов, а не кадр.
    await vi.waitFor(() => expect(pullNotes).toHaveBeenCalledWith('u_rev_unavailable'));
    expect(checkAndSyncCursor).not.toHaveBeenCalled();
  });
});
