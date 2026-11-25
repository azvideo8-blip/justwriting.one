import React from 'react';
import 'fake-indexeddb/auto';
// AUD-12: окно восстановления показывало «Восстановление завершено» даже когда
// проход упал с исключением или вернул ноль. Теперь падение рисует состояние
// ошибки, а не завершения. Фальсификация: вернуть setStep('completed') в catch —
// тест краснеет.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../../../shared/i18n';

// useLanguage вне провайдера бросает — компонент рендерится так же, как в приложении.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: LanguageProvider });
import { RestoreFromCloudModal } from '../RestoreFromCloudModal';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { DocumentService } from '../../../core/services/DocumentService';
import { LocalStorageService } from '../../../core/services/LocalStorageService';


vi.mock('../../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_restore_1' } }),
}));

vi.mock('../../../core/services/CloudSyncService', () => ({
  CloudSyncService: {
    restoreMissingDocuments: vi.fn(),
  },
}));

vi.mock('../../../features/ai/services/AIRestoreService', () => ({
  restoreAIDataFromCloud: vi.fn().mockResolvedValue({ summaries: 0, localStoreRecords: 0, failed: 0 }),
  reattachOrphanedAnalysis: vi.fn(),
}));

vi.mock('../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../core/services/LocalStorageService', () => {
  const getDocs = vi.fn().mockResolvedValue([]);
  return {
    LocalStorageService: { getDocumentsByOwner: getDocs },
  };
});

vi.mock('../../../core/sync/useEmptyDeviceDetection', () => ({
  setRestoreDismissed: vi.fn(),
}));

// R-2: битый ряд в списке облака — счётчик по прочитанной части и пометка,
// а не «не удалось загрузить количество». Мутация «обычный catch» → красный.
describe('R-2: неполный список облака в окне восстановления', () => {
  // Постоянный отказ, не Once: эффект счётчиков перезапускается (меняется t),
  // и второй вызов с [] снимал бы пометку раньше проверки.
  afterEach(() => { vi.mocked(DocumentService.getUserDocuments).mockResolvedValue([]); });
  it('показывает прочитанное и пометку о нечитаемых рядах', async () => {
    localStorage.clear();
    const e = Object.assign(new Error('UNREADABLE_CLOUD_LIST: 1'), { name: 'UnreadableCloudListError', docs: [{ id: 'c1' }, { id: 'c2' }], ids: ['bad'], uuids: ['bad'] });
    vi.mocked(DocumentService.getUserDocuments).mockRejectedValue(e);

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    await screen.findByTestId('restore-cloud-partial');
    expect(screen.getByTestId('restore-cloud-partial').textContent).toMatch(/не прочиталась \(1\)/);
    expect(screen.queryByText('Не удалось загрузить количество заметок в облаке')).toBeNull();
  });
});

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
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockResolvedValue({ restored: 0, failed: 0, hasMore: false });

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    fireEvent.click(screen.getByText('Начать загрузку'));

    // …и не выдумывает ошибку там, где проход просто ничего не нашёл.
    expect(await screen.findByText('Нечего восстанавливать')).toBeDefined();
    expect(screen.queryByText('Восстановление завершено')).toBeNull();
    expect(screen.queryByText(/прервано ошибкой/)).toBeNull();
  });

  // Дейлик 04.11 Н-2: FD-1 добавил failed/hasMore ради правды, окно их выбрасывало.
  it('names a partial success: how many failed and that more is coming', async () => {
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockResolvedValue({ restored: 3, failed: 2, hasMore: true });

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    fireEvent.click(screen.getByText('Начать загрузку'));

    expect(await screen.findByTestId('restore-cloud-notes-incomplete')).toBeDefined();
    expect(screen.getByText(/Пропущено с ошибкой: 2/)).toBeDefined();
  });

  // Ревью 0.11.6: все загрузки отбиты — это не «нечего восстанавливать».
  it('all downloads failed: says it failed, not that there is nothing to restore', async () => {
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockResolvedValue({ restored: 0, failed: 5, hasMore: true });

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    fireEvent.click(screen.getByText('Начать загрузку'));

    expect(await screen.findByText('Восстановление не удалось')).toBeDefined();
    expect(screen.queryByText('Нечего восстанавливать')).toBeNull();
  });

  it('reports numbers on a real success', async () => {
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockResolvedValue({ restored: 3, failed: 0, hasMore: false });

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    fireEvent.click(screen.getByText('Начать загрузку'));

    expect(await screen.findByText('Восстановление завершено')).toBeDefined();
    expect(screen.getByText('Данные успешно загружены')).toBeDefined();
  });

  it('AG-RESTORE-3: notes already present (restored: 0) but AI data restored: finishes on completed and dismisses empty device prompt', async () => {
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockResolvedValue({ restored: 0, failed: 0, hasMore: false });
    const onRestoreAIData = vi.fn().mockResolvedValue({
      summaries: 5,
      embeddings: 10,
      localStoreRecords: 2,
      failed: 0,
    });

    render(<RestoreFromCloudModal open onClose={() => {}} onRestoreAIData={onRestoreAIData} />);

    fireEvent.click(screen.getByText('Начать загрузку'));

    expect(await screen.findByText('Восстановление завершено')).toBeDefined();
    expect(screen.getByText('Данные успешно загружены')).toBeDefined();
    expect(onRestoreAIData).toHaveBeenCalledWith('u_restore_1');
    const { setRestoreDismissed } = await import('../../../core/sync/useEmptyDeviceDetection');
    expect(setRestoreDismissed).toHaveBeenCalledWith('u_restore_1', true);
  });

  it('AG-RESTORE-3: genuinely empty cloud (0 notes, 0 AI records): ends on failed and does not dismiss prompt', async () => {
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockResolvedValue({ restored: 0, failed: 0, hasMore: false });
    const onRestoreAIData = vi.fn().mockResolvedValue({
      summaries: 0,
      embeddings: 0,
      localStoreRecords: 0,
      failed: 0,
    });

    render(<RestoreFromCloudModal open onClose={() => {}} onRestoreAIData={onRestoreAIData} />);

    fireEvent.click(screen.getByText('Начать загрузку'));

    expect(await screen.findByText('Нечего восстанавливать')).toBeDefined();
    expect(screen.queryByText('Восстановление завершено')).toBeNull();
    const { setRestoreDismissed } = await import('../../../core/sync/useEmptyDeviceDetection');
    expect(setRestoreDismissed).not.toHaveBeenCalled();
  });

  describe('B-5.2 (F-029) counting state and error handling', () => {
    it('shows "…" while count request is pending', () => {
      vi.mocked(DocumentService.getUserDocuments).mockReturnValue(new Promise(() => {}));
      vi.mocked(LocalStorageService.getDocumentsByOwner).mockReturnValue(new Promise(() => {}));

      render(<RestoreFromCloudModal open onClose={() => {}} />);

      expect(screen.getByText(/сохранено …/)).toBeDefined();
    });

    it('shows error text and retry button when count request fails, not "0"', async () => {
      vi.mocked(DocumentService.getUserDocuments).mockRejectedValue(new Error('network error'));
      vi.mocked(LocalStorageService.getDocumentsByOwner).mockResolvedValue([]);

      render(<RestoreFromCloudModal open onClose={() => {}} />);

      expect(await screen.findByText(/Не удалось загрузить количество|restore_cloud_counts_error/)).toBeDefined();
      expect(screen.queryByText(/сохранено 0/)).toBeNull();
      expect(screen.getByText('Начать загрузку')).toBeDefined();
    });

    // F-029: состояние «считаем» ставил только useState-инициализатор, то есть
    // на первом открытии. При втором открытии висит новый запрос, а на экране —
    // прежняя цифра, которой уже нет.
    it('reopening while counts are refetched shows "…", not the previous number', async () => {
      vi.mocked(DocumentService.getUserDocuments).mockResolvedValueOnce([{}, {}] as never);
      vi.mocked(LocalStorageService.getDocumentsByOwner).mockResolvedValueOnce([] as never);

      const { rerender } = render(<RestoreFromCloudModal open onClose={() => {}} />);
      expect(await screen.findByText(/2 заметок в облаке/)).toBeDefined();

      vi.mocked(DocumentService.getUserDocuments).mockReturnValue(new Promise(() => {}));
      vi.mocked(LocalStorageService.getDocumentsByOwner).mockReturnValue(new Promise(() => {}));

      rerender(<RestoreFromCloudModal open={false} onClose={() => {}} />);
      rerender(<RestoreFromCloudModal open onClose={() => {}} />);

      expect(screen.getByText(/… заметок в облаке/)).toBeDefined();
      expect(screen.queryByText(/2 заметок в облаке/)).toBeNull();
    });
  });
});
