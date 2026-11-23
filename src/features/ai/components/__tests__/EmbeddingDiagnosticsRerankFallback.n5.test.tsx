// Ревью 0.11.24, N-5: реранк отказал, а векторный поиск отработал (порядок RRF) —
// это не «поиск не выполнился»: найденное показывается. Мутация: проверять в
// handleSearch rerankFailed вместо embedFailed — красный.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { renderWithProviders } from '../../../../test/utils/render';

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('../../utils/retrieval/searchNotes', () => ({
  searchNotes: vi.fn(async (_q: string, _n: number, opts?: { onRerankMeta?: (m: Record<string, unknown>) => void }) => {
    opts?.onRerankMeta?.({ bypassed: false, rerankFailed: true });
    return [{ id: 'doc_n5', title: 'Синтетическая находка N5', score: 0.5, content: 'синтетика', chunkIndex: 0 }];
  }),
}));
vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: { getAll: vi.fn().mockResolvedValue([]), syncPendingToCloud: vi.fn() },
}));
vi.mock('../../utils/embeddingIndexer', () => ({
  getIndexCoverage: vi.fn().mockResolvedValue({
    totalDocs: 0, indexed: 0, stale: 0, unsynced: 0, model: 'synthetic', dim: 2, lastProcessedAt: null,
  }),
  indexPending: vi.fn(),
  reindexAll: vi.fn(),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../../shared/components/ConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_n5' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { EmbeddingDiagnostics } from '../EmbeddingDiagnostics';
import { resetDbInstance } from '../../../../core/storage/localDb';

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); resetDbInstance(); });
afterEach(() => { cleanup(); });

describe('N-5: отказ реранка при рабочем поиске — найденное показывается', () => {
  it('rerankFailed без embedFailed — результаты на экране, без тоста отказа', async () => {
    renderWithProviders(<EmbeddingDiagnostics />);
    const input = await screen.findByLabelText('Тестовый поиск по заметкам');
    fireEvent.change(input, { target: { value: 'синтетический запрос n5' } });
    fireEvent.click(screen.getByText('Найти'));
    expect(await screen.findByText(/Синтетическая находка N5/)).toBeTruthy();
    expect(mocks.showToast).not.toHaveBeenCalledWith(expect.stringMatching(/Поиск не выполнился/), 'error');
  });
});
