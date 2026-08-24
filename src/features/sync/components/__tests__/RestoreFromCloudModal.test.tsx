// AUD-12: окно восстановления показывало «Восстановление завершено» даже когда
// проход упал с исключением или вернул ноль. Теперь падение рисует состояние
// ошибки, а не завершения. Фальсификация: вернуть setStep('completed') в catch —
// тест краснеет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RestoreFromCloudModal } from '../RestoreFromCloudModal';
import { CloudSyncService } from '../../../../core/services/CloudSyncService';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

vi.mock('../../../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_restore_1' } }),
}));

vi.mock('../../../../core/services/CloudSyncService', () => ({
  CloudSyncService: {
    restoreMissingDocuments: vi.fn(),
  },
}));

vi.mock('../../../ai/services/AIRestoreService', () => ({
  restoreAIDataFromCloud: vi.fn().mockResolvedValue({ summaries: 0, localStoreRecords: 0, failed: 0 }),
  reattachOrphanedAnalysis: vi.fn(),
}));

vi.mock('../../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../../core/services/LocalStorageService', () => ({
  LocalStorageService: { getGuestDocuments: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../hooks/useEmptyDeviceDetection', () => ({
  setRestoreDismissed: vi.fn(),
}));

describe('AUD-12 restore modal reports failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows the failed state, not "завершено", when the pass throws', async () => {
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockRejectedValue(new Error('offline'));

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    fireEvent.click(screen.getByText('Начать загрузку'));

    expect(await screen.findByText('Восстановление не удалось')).toBeDefined();
    expect(screen.queryByText('Восстановление завершено')).toBeNull();
    expect(screen.queryByText('Данные успешно загружены')).toBeNull();
  });

  it('never shows completion for a pass that restored nothing', async () => {
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockResolvedValue({ restored: 0, hasMore: false });

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    fireEvent.click(screen.getByText('Начать загрузку'));

    expect(await screen.findByText('Восстановление не удалось')).toBeDefined();
    expect(screen.queryByText('Восстановление завершено')).toBeNull();
  });

  it('reports numbers on a real success', async () => {
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockResolvedValue({ restored: 3 });

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    fireEvent.click(screen.getByText('Начать загрузку'));

    expect(await screen.findByText('Восстановление завершено')).toBeDefined();
    expect(screen.getByText('Данные успешно загружены')).toBeDefined();
  });
});
