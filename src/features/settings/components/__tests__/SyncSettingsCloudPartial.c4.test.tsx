import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// C4: битый ряд в облаке — «синхронизировать всё» показывало успех, хотя
// скачано не всё. Мутация: убрать проверку `dlRes.incomplete` → красный.
const h = vi.hoisted(() => ({ showToast: vi.fn(), downloadAll: vi.fn() }));

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true, user: { uid: 'u-c4' } }) }));
vi.mock('../../../../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0, deadCount: 0, unsyncedCount: 0 }) }));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: {
    syncPending: vi.fn(),
    getDeadCount: vi.fn().mockResolvedValue(0),
    syncAllUnlinked: vi.fn().mockResolvedValue({ synced: 0, failed: 0 }),
    downloadAllFromCloud: (...a: unknown[]) => h.downloadAll(...a),
  },
}));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({ getOversizedRecordCount: vi.fn().mockResolvedValue(0) }));
vi.mock('../../../../core/storage/storagePersistence', () => ({ getStoragePersistenceStatus: vi.fn().mockResolvedValue(null), requestPersistentStorage: vi.fn() }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn() }));

import { SyncSettingsSection } from '../SyncSettingsSection';
import { setCloudSyncEnabled } from '../../../../core/sync/cloudSyncEnabled';

describe('C4: неполное облако видно в «синхронизировать всё»', () => {
  beforeEach(() => {
    localStorage.clear();
    h.showToast.mockClear();
    setCloudSyncEnabled('u-c4', true);
  });

  it('incomplete → предупреждение', async () => {
    h.downloadAll.mockResolvedValue({ downloaded: 3, skipped: 0, failed: 0, incomplete: true });
    render(<SyncSettingsSection userId="u-c4" />);
    fireEvent.click(await screen.findByTestId('sync-all-unlinked-btn'));
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('settings_sync_cloud_partial', 'warning'));
  });

  it('полный список → без предупреждения', async () => {
    h.downloadAll.mockResolvedValue({ downloaded: 3, skipped: 0, failed: 0 });
    render(<SyncSettingsSection userId="u-c4" />);
    fireEvent.click(await screen.findByTestId('sync-all-unlinked-btn'));
    await waitFor(() => expect(h.showToast).toHaveBeenCalled());
    expect(h.showToast).not.toHaveBeenCalledWith('settings_sync_cloud_partial', 'warning');
  });
});
