import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true, user: { uid: 'u-n42' } }) }));
vi.mock('../../../../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'sync_off', pendingCount: 0, deadCount: 0 }) }));
vi.mock('../../../../core/services/SyncService', () => ({ SyncService: { syncPending: vi.fn(), getDeadCount: vi.fn().mockResolvedValue(0) } }));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({ getOversizedRecordCount: vi.fn().mockResolvedValue(0) }));
vi.mock('../../../../core/storage/storagePersistence', () => ({ getStoragePersistenceStatus: vi.fn().mockResolvedValue(null), requestPersistentStorage: vi.fn() }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => vi.fn() }));

import { SyncSettingsSection } from '../SyncSettingsSection';
import { setCloudSyncEnabled } from '../../../../core/sync/cloudSyncEnabled';

// N-42: синхронизацию включили не в настройках (окно вопроса, восстановление
// из облака) — переключатель в открытых настройках это видит сразу.
describe('sync toggle in settings', () => {
  it('follows a change made elsewhere in the same tab', async () => {
    localStorage.clear();
    render(<SyncSettingsSection userId="u-n42" />);
    const sw = await screen.findByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    act(() => { setCloudSyncEnabled('u-n42', true); });
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });
});
