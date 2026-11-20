// d41h (Н-8): RestoreFromCloudModal не читает locked/throttled у
// CloudSyncService.restoreMissingDocuments (:565-566) и skippedLocked/sectionFailed
// у restoreAndReattachAIData (AIRestoreService:411-413,460-463). Запертый сейф:
// {restored:0, failed:0, hasMore:false, locked:true} → «Нечего восстанавливать»
// (restore_cloud_title_empty), хотя в облаке лежат заметки. Нечитаемый журнал
// удалений (sectionFailed) при восстановленных заметках → зелёное «завершено»
// без предупреждения. Настоящий RestoreFromCloudModal; моки только края
// (облачное восстановление, счётчики, auth).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createElement as h } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const restoreMissingDocuments = vi.hoisted(() => vi.fn());
const restoreAIData = vi.hoisted(() => vi.fn());

vi.mock('@/features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u-d41h' } }),
}));
vi.mock('@/core/services/CloudSyncService', () => ({
  CloudSyncService: { restoreMissingDocuments },
}));
vi.mock('@/core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: vi.fn(async () => []) },
}));
vi.mock('@/core/services/LocalStorageService', () => ({
  LocalStorageService: { getDocumentsByOwner: vi.fn(async () => []) },
}));
vi.mock('@/core/services/rateGate', () => ({ withRateLimitRetry: (fn: () => Promise<unknown>) => fn() }));
vi.mock('@/core/sync/useEmptyDeviceDetection', () => ({ setRestoreDismissed: vi.fn() }));
vi.mock('@/shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n: number) => `${k}:${n}`, language: 'ru' }),
}));

import { RestoreFromCloudModal } from '@/app/modals/RestoreFromCloudModal';

function renderModal() {
  return render(h(RestoreFromCloudModal, {
    open: true,
    onClose: vi.fn(),
    initialLocalCount: 0,
    initialCloudCount: 3,
    onRestoreAIData: restoreAIData,
  }));
}

beforeEach(() => { cleanup(); vi.clearAllMocks(); });

describe('d41h: запертый сейф при восстановлении из облака назван, а не «Нечего восстанавливать»', () => {
  it('restoreMissingDocuments вернул locked:true — не «нечего восстанавливать»', async () => {
    restoreMissingDocuments.mockResolvedValue({ restored: 0, failed: 0, hasMore: false, locked: true });
    restoreAIData.mockResolvedValue({ summaries: 0, embeddings: 0, localStoreRecords: 0, failed: 0 });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'restore_cloud_btn_start' }));
    await waitFor(() => { expect(restoreMissingDocuments).toHaveBeenCalled(); });
    await waitFor(() => {
      expect(
        screen.queryByText('restore_cloud_title_empty') ?? screen.queryByText('restore_cloud_title_failed') ?? screen.queryByText('restore_cloud_title_locked'),
        'итог восстановления должен быть назван',
      ).toBeTruthy();
    });
    expect(
      screen.queryByText('restore_cloud_title_empty'),
      'сейф заперт, заметки в облаке есть, а окно говорит «Нечего восстанавливать»',
    ).toBeNull();
    // FN-8: отдельный итог «Сейф заперт — открой и повтори».
    expect(screen.getByText('restore_cloud_title_locked')).toBeTruthy();
    expect(screen.getByText('restore_cloud_fail_locked')).toBeTruthy();
  });

  it('FN-8: заметок нет, а ИИ-раздел отказал не из-за замка (sectionFailed) — «не удалось», не «нечего восстанавливать»', async () => {
    restoreMissingDocuments.mockResolvedValue({ restored: 0, failed: 0, hasMore: false });
    restoreAIData.mockResolvedValue({ summaries: 0, embeddings: 0, localStoreRecords: 0, failed: 0, sectionFailed: true });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'restore_cloud_btn_start' }));
    await waitFor(() => { expect(screen.getByText('restore_cloud_title_failed')).toBeTruthy(); });
    expect(screen.queryByText('restore_cloud_title_empty')).toBeNull();
  });

  it('КОНТРОЛЬ: облако ответило пустым списком без отказа — «Нечего восстанавливать» честно', async () => {
    restoreMissingDocuments.mockResolvedValue({ restored: 0, failed: 0, hasMore: false });
    restoreAIData.mockResolvedValue({ summaries: 0, embeddings: 0, localStoreRecords: 0, failed: 0 });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'restore_cloud_btn_start' }));
    await waitFor(() => { expect(screen.getByText('restore_cloud_title_empty')).toBeTruthy(); });
  });

  it('заметки восстановлены, но ИИ-раздел пропущен (skippedLocked/sectionFailed) — предупреждение в итоге', async () => {
    restoreMissingDocuments.mockResolvedValue({ restored: 1, failed: 0, hasMore: false });
    restoreAIData.mockResolvedValue({
      summaries: 0, embeddings: 0, localStoreRecords: 0, failed: 0,
      skippedLocked: true, sectionFailed: true,
    });
    renderModal(); // модалка в портале — ищем по document, не по container
    fireEvent.click(screen.getByRole('button', { name: 'restore_cloud_btn_start' }));
    await waitFor(() => { expect(screen.getByText('restore_cloud_success_title')).toBeTruthy(); });
    expect(
      document.querySelector('.text-accent-warning, .text-accent-danger'),
      'ИИ-раздел не восстановлен (сейф заперт / журнал удалений не читается), а итог — зелёное «завершено» без предупреждения',
    ).toBeTruthy();
  });
});
