// FN-7 (дейлик 20.11, Н-7): повторная опись перед уборкой сирот не прочитала облако —
// то же «Облако недоступно», что у первой описи, а не зелёное «Убрано: 0/0».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k }) }));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isAuthenticated: true, user: { uid: 'u-fn7' } }) }));
vi.mock('../../../../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0, deadCount: 0, unsyncedCount: 0 }) }));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncPending: vi.fn(), getDeadCount: vi.fn().mockResolvedValue(0), syncAllUnlinked: vi.fn(), downloadAllFromCloud: vi.fn() },
}));
vi.mock('../../../../core/services/LocalStoreSyncService', () => ({ getOversizedRecordCount: vi.fn().mockResolvedValue(0) }));
vi.mock('../../../../core/storage/storagePersistence', () => ({ getStoragePersistenceStatus: vi.fn().mockResolvedValue(null), requestPersistentStorage: vi.fn() }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: h.showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }) }));

import { SyncSettingsSection } from '../SyncSettingsSection';
import { setCloudSyncEnabled } from '../../../../core/sync/cloudSyncEnabled';

const survey = { cloudChecked: true, summaries: ['s1'], embeddings: [], cloudSummaries: [], cloudEmbeddings: [] };

async function clean(removed: { summaries: number; embeddings: number; failed: number; cloudChecked?: boolean }) {
  render(
    <SyncSettingsSection
      userId="u-fn7"
      onFindOrphans={vi.fn(async () => survey) as never}
      onDeleteOrphans={vi.fn(async () => removed)}
    />,
  );
  fireEvent.click(await screen.findByTestId('clean-orphans-btn'));
}

describe('FN-7: уборка сирот ИИ — отказ повторной описи назван', () => {
  beforeEach(() => { localStorage.clear(); h.showToast.mockClear(); setCloudSyncEnabled('u-fn7', true); });

  it('cloudChecked=false в ответе уборки — «облако недоступно», без «Убрано»', async () => {
    await clean({ summaries: 0, embeddings: 0, failed: 0, cloudChecked: false });
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('settings_sync_orphans_offline', 'error'));
    expect(h.showToast).not.toHaveBeenCalledWith('settings_sync_orphans_done', 'success');
  });

  it('КОНТРОЛЬ: опись состоялась — «Убрано»', async () => {
    await clean({ summaries: 1, embeddings: 0, failed: 0, cloudChecked: true });
    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('settings_sync_orphans_done', 'success'));
    expect(h.showToast).not.toHaveBeenCalledWith('settings_sync_orphans_offline', 'error');
  });
});
