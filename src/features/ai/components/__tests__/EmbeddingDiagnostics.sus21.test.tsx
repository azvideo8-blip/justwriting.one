// NB-17 №21б (sus21): отказ embed в тестовом поиске — «поиск не выполнился»,
// а не «ничего не найдено». Компонент настоящий (EmbeddingDiagnostics),
// searchNotes настоящий; моки только края: embed, облако эмбеддингов, покрытие
// индекса, тост, auth. Мутация: убрать ветку rerankFailed в handleSearch —
// красный а.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { renderWithProviders } from '../../../../test/utils/render';

const mocks = vi.hoisted(() => ({
  embed: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('../../services/AIService', () => ({
  AIService: { embed: (...a: unknown[]) => mocks.embed(...a), summarize: vi.fn() },
}));
vi.mock('../../services/AIEmbeddingService', () => ({
  AIEmbeddingService: {
    getAll: vi.fn().mockResolvedValue([]),
    syncPendingToCloud: vi.fn().mockResolvedValue({ synced: 0, failed: 0, waiting: 0, locked: false }),
  },
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
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u_sus21' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { EmbeddingDiagnostics } from '../EmbeddingDiagnostics';
import { resetDbInstance } from '../../../../core/storage/localDb';

const FAILED_TEXT = 'Поиск не выполнился: не удалось построить вектор запроса';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetDbInstance();
  localStorage.setItem('ai_indexing_consent_v2_u_sus21', 'granted');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function runSearch() {
  renderWithProviders(<EmbeddingDiagnostics />);
  const input = await screen.findByLabelText('Тестовый поиск по заметкам');
  fireEvent.change(input, { target: { value: 'синтетический запрос sus21' } });
  fireEvent.click(screen.getByText('Найти'));
}

describe('NB-17 №21б: отказ embed в тесте поиска назван', () => {
  it('а) embed отказал — «поиск не выполнился», не «ничего не найдено»', async () => {
    mocks.embed.mockResolvedValue({ ok: false, error: 'SYNTHETIC_EMBED_REFUSAL' });
    await runSearch();
    expect(await screen.findByText(FAILED_TEXT)).toBeTruthy();
    expect(mocks.showToast).toHaveBeenCalledWith(FAILED_TEXT, 'error');
    expect(screen.queryByText(/Ничего не найдено/)).toBeNull();
  });

  it('контроль: embed прошёл, кандидатов нет — «ничего не найдено» как раньше', async () => {
    mocks.embed.mockResolvedValue({ ok: true, vectors: [[0.1, 0.2]] });
    await runSearch();
    expect(await screen.findByText(/Ничего не найдено/)).toBeTruthy();
    expect(mocks.showToast).not.toHaveBeenCalledWith(FAILED_TEXT, 'error');
    expect(screen.queryByText(FAILED_TEXT)).toBeNull();
  });
});

describe('PIN-1: выгрузка и индексация — отказ назван', () => {
  async function renderWithCoverage() {
    const { getIndexCoverage } = await import('../../utils/embeddingIndexer');
    vi.mocked(getIndexCoverage).mockResolvedValue({
      totalDocs: 2, indexed: 0, stale: 2, unsynced: 2, model: 'synthetic', dim: 2, lastProcessedAt: null,
    });
    renderWithProviders(<EmbeddingDiagnostics />);
  }

  it('PIN-1: сейф заперт при выгрузке — error, не успех', async () => {
    const { AIEmbeddingService } = await import('../../services/AIEmbeddingService');
    vi.mocked(AIEmbeddingService.syncPendingToCloud).mockResolvedValue({ synced: 0, pending: 0, failed: 0, waiting: 0, locked: true });
    await renderWithCoverage();
    fireEvent.click(await screen.findByText('В облако (2)'));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Синхронизировано 0; остальное ждёт — разблокируй E2E-шифрование', 'error'));
    expect(mocks.showToast.mock.calls.filter(c => c[1] === 'success')).toHaveLength(0);
  });

  it('PIN-1: часть векторов не выгрузилась — warning, не успех', async () => {
    const { AIEmbeddingService } = await import('../../services/AIEmbeddingService');
    vi.mocked(AIEmbeddingService.syncPendingToCloud).mockResolvedValue({ synced: 1, pending: 0, failed: 2, waiting: 0, locked: false });
    await renderWithCoverage();
    fireEvent.click(await screen.findByText('В облако (2)'));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Выгружено векторов: 1, не удалось: 2', 'warning'));
    expect(mocks.showToast.mock.calls.filter(c => c[1] === 'success')).toHaveLength(0);
  });

  it('PIN-1: векторы ждут заметку в облаке — info, не успех', async () => {
    const { AIEmbeddingService } = await import('../../services/AIEmbeddingService');
    vi.mocked(AIEmbeddingService.syncPendingToCloud).mockResolvedValue({ synced: 1, pending: 0, failed: 0, waiting: 3, locked: false });
    await renderWithCoverage();
    fireEvent.click(await screen.findByText('В облако (2)'));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Выгружено векторов: 1; ждут заметку в облаке: 3', 'info'));
    expect(mocks.showToast.mock.calls.filter(c => c[1] === 'success')).toHaveLength(0);
  });

  it('PIN-1: индексация с ошибками — warning, не зелёный итог', async () => {
    const { indexPending } = await import('../../utils/embeddingIndexer');
    vi.mocked(indexPending).mockResolvedValue({ ok: 1, skipped: 0, failed: 2 } as never);
    await renderWithCoverage();
    fireEvent.click(await screen.findByText('Индексировать сейчас (2)'));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Индексация: +1 новых, 0 пропущено, 2 ошибок', 'warning'));
    expect(mocks.showToast.mock.calls.filter(c => c[1] === 'success')).toHaveLength(0);
  });
});