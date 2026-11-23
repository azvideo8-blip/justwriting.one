import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../../../shared/i18n';
import { RestoreFromCloudModal } from '../RestoreFromCloudModal';
import { CloudSyncService } from '../../../core/services/CloudSyncService';
import { DocumentService } from '../../../core/services/DocumentService';

const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: LanguageProvider });

vi.mock('../../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_restore_sus25' } }),
}));

vi.mock('../../../core/services/CloudSyncService', () => ({
  CloudSyncService: { restoreMissingDocuments: vi.fn() },
}));

vi.mock('../../../features/ai/services/AIRestoreService', () => ({
  restoreAIDataFromCloud: vi.fn(),
  reattachOrphanedAnalysis: vi.fn(),
}));

vi.mock('../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../core/services/LocalStorageService', () => ({
  LocalStorageService: { getDocumentsByOwner: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../core/sync/useEmptyDeviceDetection', () => ({
  setRestoreDismissed: vi.fn(),
}));

// NB-10 (sus25): окно восстановления читает sectionFailed из итога
// restoreAndReattachAIData. Закрепляем: пропущенные разделы видны баннером,
// а ноль восстановленного с отказом — итог ошибки, не «завершено».
describe('sus25: модалка называет пропущенные разделы ИИ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(DocumentService.getUserDocuments).mockResolvedValue([]);
    vi.mocked(CloudSyncService.restoreMissingDocuments).mockResolvedValue({ restored: 0, failed: 0, hasMore: false });
  });

  const start = async (aiRes: { summaries: number; localStoreRecords: number; failed: number; sectionFailed?: boolean; analysisJournalUnreadable?: boolean }) => {
    render(
      <RestoreFromCloudModal
        open
        onClose={() => {}}
        onRestoreAIData={() => Promise.resolve({ embeddings: 0, ...aiRes })}
      />,
    );
    fireEvent.click(screen.getByText('Начать загрузку'));
  };

  it('частичный успех с sectionFailed → баннер «разделы пропущены»', async () => {
    await start({ summaries: 2, localStoreRecords: 0, failed: 0, sectionFailed: true });

    const banner = await screen.findByTestId('restore-cloud-ai-skipped');
    expect(banner.textContent).toMatch(/не полностью/);
  });

  it('ноль восстановленного + sectionFailed → итог ошибки, не «завершено»', async () => {
    await start({ summaries: 0, localStoreRecords: 0, failed: 0, sectionFailed: true });

    expect(await screen.findByText('Восстановление не удалось')).toBeDefined();
    expect(screen.queryByText('Восстановление завершено')).toBeNull();
  });

  // Ревью 0.11.24: битый журнал удалений разборов — отдельное поле итога; окно
  // называет его так же, как пропуск раздела. Мутация: не читать
  // analysisJournalUnreadable в окне — баннера нет, красный.
  it('журнал удалений разборов не читается → баннер «разделы пропущены»', async () => {
    await start({ summaries: 2, localStoreRecords: 0, failed: 0, analysisJournalUnreadable: true });

    const banner = await screen.findByTestId('restore-cloud-ai-skipped');
    expect(banner.textContent).toMatch(/не полностью/);
  });

  it('контроль: разделы не пропущены → «завершено» без баннера', async () => {
    await start({ summaries: 2, localStoreRecords: 0, failed: 0, sectionFailed: false });

    expect(await screen.findByText('Восстановление завершено')).toBeDefined();
    expect(screen.queryByTestId('restore-cloud-ai-skipped')).toBeNull();
  });
});