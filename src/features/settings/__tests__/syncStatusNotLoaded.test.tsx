import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const syncStatus = { status: 'sync_off', loaded: false, pendingCount: 0, deadCount: 0 };
vi.mock('../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true, user: { uid: 'u-m13' } }) }));
vi.mock('../../../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));
vi.mock('../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => syncStatus }));
vi.mock('../../../core/services/SyncService', () => ({ SyncService: { syncPending: vi.fn(), getDeadCount: vi.fn().mockResolvedValue(0) } }));
vi.mock('../../../core/services/LocalStoreSyncService', () => ({ getOversizedRecordCount: vi.fn().mockResolvedValue(0) }));
vi.mock('../../../core/storage/storagePersistence', () => ({ getStoragePersistenceStatus: vi.fn().mockResolvedValue(null), requestPersistentStorage: vi.fn() }));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn() }));

import { SyncSettingsSection } from '../components/SyncSettingsSection';

// M-13: до первого замера статус — нейтральный sync_off, и настройки читали его
// как «Всё есть в облаке» — неправда, которую никто не проверял.
describe('M-13: settings do not claim «all in the cloud» before the first poll', () => {
  beforeEach(() => localStorage.clear());

  it('not loaded: a checking text, not sync_off_all_uploaded', async () => {
    syncStatus.loaded = false;
    render(<SyncSettingsSection userId="u-m13" />);
    expect(await screen.findByText('sync_status_checking')).toBeTruthy();
    expect(screen.queryByText('sync_off_all_uploaded')).toBeNull();
  });

  it('loaded with auto-sync off: sync_off_all_uploaded', async () => {
    syncStatus.loaded = true;
    render(<SyncSettingsSection userId="u-m13" />);
    expect(await screen.findByText('sync_off_all_uploaded')).toBeTruthy();
    expect(screen.queryByText('sync_status_checking')).toBeNull();
  });
});
