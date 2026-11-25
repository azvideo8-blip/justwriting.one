// DW6-5.4 (находка ревью 0.11.6): окно восстановления читало список облака без
// общего тормоза 429. Один отбитый запрос показывал «не удалось загрузить
// количество», хотя сервер просил просто помедленнее, — класс «нет ответа ≠ нет».
//
// Мутация: снять `withRateLimitRetry` вокруг `DocumentService.getUserDocuments` —
// кейс 1 краснеет (один вызов и состояние ошибки).
import React from 'react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../shared/i18n';

const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: LanguageProvider });

vi.mock('../../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: { uid: 'u_restore_429' } }),
}));
vi.mock('../../../core/services/CloudSyncService', () => ({
  CloudSyncService: { restoreMissingDocuments: vi.fn() },
}));
vi.mock('../../../features/ai/services/AIRestoreService', () => ({
  restoreAIDataFromCloud: vi.fn().mockResolvedValue({ summaries: 0, localStoreRecords: 0, failed: 0 }),
  reattachOrphanedAnalysis: vi.fn(),
}));
vi.mock('../../../core/services/DocumentService', () => ({
  DocumentService: { getUserDocuments: vi.fn() },
}));
vi.mock('../../../core/services/LocalStorageService', () => ({
  LocalStorageService: { getDocumentsByOwner: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../core/sync/useEmptyDeviceDetection', () => ({
  setRestoreDismissed: vi.fn(),
}));

import { getLocalDb } from '../../../core/storage/localDb';
import { RestoreFromCloudModal } from '../RestoreFromCloudModal';
import { DocumentService } from '../../../core/services/DocumentService';
import { rateLimitTuning, withRateLimitRetry } from '../../../core/services/rateGate';

const realTuning = { ...rateLimitTuning };

// Модалке нужна только длина списка: форма ряда — как её отдаёт провайдер.
function cloudDocs(n: number): never[] {
  return Array.from({ length: n }, (_, i) => ({ id: `c_${i}`, user_id: 'u_restore_429', uuid: `c_${i}` })) as never[];
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  rateLimitTuning.baseMs = 1;
  rateLimitTuning.maxMs = 1;
  // Текущая пауза тормоза снимается только успешным вызовом (`resetRateGate`), а
  // она при загрузке модуля равна прода-базе (2 с). Один холостой проход возвращает
  // её к 1 мс, чтобы тест не спал минуту на реальных значениях.
  await withRateLimitRetry(async () => 'warm');
  vi.mocked(DocumentService.getUserDocuments).mockResolvedValue(cloudDocs(3));
});

afterEach(() => {
  Object.assign(rateLimitTuning, realTuning);
});

describe('DW6-5.4: 429 в окне восстановления — «помедленнее», а не «не удалось»', () => {
  it('429 на списке облака повторяется, и окно показывает прочитанные числа', async () => {
    vi.mocked(DocumentService.getUserDocuments)
      .mockRejectedValueOnce(new Error('<html><body>Too Many Requests</body></html>'))
      .mockResolvedValue(cloudDocs(3));

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    expect(await screen.findByText(/\(3 заметок в облаке\)/), 'числа облака не показаны').toBeDefined();
    expect(screen.queryByText(/Не удалось загрузить количество/), '429 показан как сбой чтения').toBeNull();
    expect(vi.mocked(DocumentService.getUserDocuments).mock.calls.length, 'отбитый 429 не повторён').toBeGreaterThanOrEqual(2);
  });

  // PR-1 (стенд 25.11): удалённая, чьё удаление ждёт облака, в счёт не идёт — ни в
  // полном списке, ни в частичном. Мутация: не отсеивать ждущих удаления — красный.
  it.each([
    ['полный список', () => vi.mocked(DocumentService.getUserDocuments).mockResolvedValue(cloudDocs(3))],
    ['частичный', () => vi.mocked(DocumentService.getUserDocuments).mockRejectedValue(Object.assign(new Error('UNREADABLE_CLOUD_LIST: 1'), { name: 'UnreadableCloudListError', docs: cloudDocs(3), ids: ['bad'], uuids: ['bad'] }))],
  ])('ждущая удаления заметка не предлагается: %s', async (_n, arrange) => {
    arrange();
    const db = await getLocalDb('u_restore_429');
    await db.put('syncQueue', { id: 'delete_c_0', documentId: 'c_0', type: 'delete', createdAt: 1, ownerId: 'u_restore_429', revocable: true });
    render(<RestoreFromCloudModal open onClose={() => {}} />);
    expect(await screen.findByText(/2 заметок в облаке/)).toBeDefined();
    await db.clear('syncQueue');
  });

  it('стойкий не-429 остаётся ошибкой чтения, а не нулями', async () => {
    vi.mocked(DocumentService.getUserDocuments)
      .mockRejectedValue(new Error('NETWORK: облако не ответило'));

    render(<RestoreFromCloudModal open onClose={() => {}} />);

    expect(await screen.findByText(/Не удалось загрузить количество/)).toBeDefined();
    // Эффект счётчиков перезапускается, поэтому здесь важно качество: повторен был
    // бы ТОЛЬКО 429, а сбой сети остаётся сбоем.
    expect(DocumentService.getUserDocuments).toHaveBeenCalled();
  });
});
