import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

const downloadAllFromCloud = vi.fn(async () => ({ downloaded: 1, skipped: 0, failed: 0 }));
const syncPending = vi.fn(async () => undefined);
const reviveLockedTasks = vi.fn(async () => 0);

vi.mock('../../core/services/SyncService', () => ({
  SyncService: { downloadAllFromCloud, syncPending, reviveLockedTasks },
}));

let mockOnline = false;
vi.mock('../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockOnline,
}));

vi.mock('../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_sync_test' } }),
}));

const { SyncManager } = await import('../AppProviders');
const { VAULT_UNLOCKED_EVENT } = await import('../../core/crypto/useEncryptionStore');

describe('SyncManager triggers downloadAllFromCloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTO_SYNC_ENABLED('u_sync_test'), 'true');
    mockOnline = false;
  });

  it('triggers downloadAllFromCloud on mount when user is authenticated and autoSync is enabled', () => {
    render(<SyncManager />);
    expect(downloadAllFromCloud).toHaveBeenCalledWith('u_sync_test');
  });

  it('triggers downloadAllFromCloud on online recovery', () => {
    mockOnline = false;
    const { rerender } = render(<SyncManager />);
    vi.clearAllMocks();

    mockOnline = true;
    rerender(<SyncManager />);

    expect(downloadAllFromCloud).toHaveBeenCalledWith('u_sync_test');
    // D-22: автоматический проход не форсирует отправку — при выключенной
    // синхронизации в облако не уходит ничего; решает сам syncPending.
    expect(syncPending).toHaveBeenCalledWith('u_sync_test');
  });

  it('triggers downloadAllFromCloud on vault unlocked event', async () => {
    render(<SyncManager />);
    vi.clearAllMocks();

    window.dispatchEvent(new CustomEvent(VAULT_UNLOCKED_EVENT));
    await new Promise((r) => setTimeout(r, 0));

    expect(downloadAllFromCloud).toHaveBeenCalledWith('u_sync_test');
  });
});
