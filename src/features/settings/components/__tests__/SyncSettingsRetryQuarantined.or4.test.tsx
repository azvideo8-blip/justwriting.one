import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// OR-4: «Повторить» у отложенных заметок молчало при отказе и паузе.
// Мутация: не читать итог syncPending в handleRetryQuarantined → красный.
const h = vi.hoisted(() => ({ showToast: vi.fn(), syncPending: vi.fn() }));

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true, user: { uid: 'u-or4' } }) }));
vi.mock('../../../../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'pending', pendingCount: 1, deadCount: 2, unsyncedCount: 1 }) }));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncPending: (...a: unknown[]) => h.syncPending(...a), retryQuarantinedTasks: vi.fn().mockResolvedValue(2) },
}));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({ getOversizedRecordCount: vi.fn().mockResolvedValue(0) }));
vi.mock('../../../../core/storage/storagePersistence', () => ({ getStoragePersistenceStatus: vi.fn().mockResolvedValue(null), requestPersistentStorage: vi.fn() }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn() }));

import { SyncSettingsSection } from '../SyncSettingsSection';
import { setCloudSyncEnabled } from '../../../../core/sync/cloudSyncEnabled';

const retry = async () => {
  render(<SyncSettingsSection userId="u-or4" />);
  fireEvent.click(await screen.findByText('sync_quarantined_retry'));
  await waitFor(() => expect(h.syncPending).toHaveBeenCalled());
};

describe('OR-4: «Повторить» называет итог', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setCloudSyncEnabled('u-or4', true);
  });

  it.each([
    [{ drained: 0, failed: 1 }, 'sync_retry_failed', 'error'],
    [{ drained: 0, failed: 0, skippedReason: 'vault_locked' }, 'settings_sync_vault_locked', 'error'],
    [{ drained: 0, failed: 0, skippedReason: 'offline' }, 'sync_paused_no_network', 'info'],
    [{ drained: 0, failed: 0, skippedReason: 'in_progress' }, 'sync_already_running', 'info'],
    [{ drained: 0, failed: 0, skippedReason: 'sync_disabled' }, 'sync_queue_disabled', 'info'],
    // DA-2: синхронизация выключена, удаления ушли — не «выключена».
    [{ drained: 1, failed: 0, deletesOnly: true }, 'sync_queue_deletes_only', 'info'],
  ])('%j → %s', async (res, key, kind) => {
    h.syncPending.mockResolvedValue(res);
    await retry();
    await waitFor(() => expect(h.showToast.mock.calls).toEqual([[key, kind]]));
  });

  it('всё ушло — без сообщения', async () => {
    h.syncPending.mockResolvedValue({ drained: 2, failed: 0 });
    await retry();
    await waitFor(() => expect((screen.getByText('sync_quarantined_retry') as HTMLButtonElement).disabled).toBe(false));
    expect(h.showToast).not.toHaveBeenCalled();
  });
});
