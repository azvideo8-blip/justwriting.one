import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { DocumentPreview } from '../DocumentPreview';
import * as ArchiveExportService from '../../../../core/services/ArchiveExportService';
import type { ArchiveSession } from '../../types';

const mockAnalyze = vi.fn();
const mockFetchSummary = vi.fn();
const mockFetchRelatedNotes = vi.fn();

const mockSession: ArchiveSession = {
  id: 'doc-1',
  userId: 'user-1',
  title: 'Тестовая заметка',
  content: 'Текст заметки для проверки превью компонента.',
  duration: 60,
  wordCount: 10,
  charCount: 50,
  wpm: 10,
  tags: ['тест'],
  createdAt: Date.now(),
  _isLocal: true,
};

function renderPreview(session: ArchiveSession | null) {
  return renderWithProviders(
    <ToastProvider>
      <DocumentPreview
        session={session}
        onClose={vi.fn()}
        onContinue={vi.fn()}
        onAnalyzeNote={mockAnalyze}
        fetchSummary={mockFetchSummary}
        fetchRelatedNotes={mockFetchRelatedNotes}
      />
    </ToastProvider>
  );
}

describe('DocumentPreview — AI Analysis button states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchSummary.mockResolvedValue(null);
    mockFetchRelatedNotes.mockResolvedValue([]);
  });

  it('renders "Проанализировать" button and not a spinner when note has no summary', async () => {
    renderPreview(mockSession);

    await waitFor(() => {
      expect(screen.getByText('Проанализировать')).toBeInTheDocument();
    });
    expect(screen.queryByText('анализируется…')).not.toBeInTheDocument();
  });

  it('calls onAnalyzeNote once and shows in-flight state when button is pressed', async () => {
    let resolveAnalyze: (value: { ok: true } | { ok: false; error: 'TOO_SHORT' }) => void;
    const analyzePromise = new Promise<{ ok: true } | { ok: false; error: 'TOO_SHORT' }>((resolve) => {
      resolveAnalyze = resolve;
    });
    mockAnalyze.mockReturnValue(analyzePromise);

    renderPreview(mockSession);

    const button = await screen.findByText('Проанализировать');
    fireEvent.click(button);

    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(mockAnalyze).toHaveBeenCalledWith('doc-1');

    expect(await screen.findByText('анализируется…')).toBeInTheDocument();

    resolveAnalyze!({ ok: true });
  });

  it('tells the user to refresh after a successful analysis if summary is not yet loaded into view', async () => {
    mockAnalyze.mockResolvedValue({ ok: true });

    renderPreview(mockSession);

    const button = await screen.findByText('Проанализировать');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Обновите страницу, чтобы увидеть разбор')).toBeInTheDocument();
    });
  });

  it('offers no analysis and explains why when note is marked "hidden from AI"', async () => {
    const excludedSession: ArchiveSession = {
      ...mockSession,
      excludedFromAI: true,
    };

    renderPreview(excludedSession);

    await waitFor(() => {
      expect(screen.getByText('Заметка скрыта от ИИ. Разбор недоступен')).toBeInTheDocument();
    });
    expect(screen.queryByText('Проанализировать')).not.toBeInTheDocument();
    expect(screen.queryByText('анализируется…')).not.toBeInTheDocument();
  });

  it('displays a user-actionable refusal message when analyze() rejects with TOO_SHORT', async () => {
    mockAnalyze.mockResolvedValue({ ok: false, error: 'TOO_SHORT' });

    renderPreview(mockSession);

    const button = await screen.findByText('Проанализировать');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getAllByText('Заметка слишком короткая для разбора').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays version count when note has multiple versions (L-10)', async () => {
    const multiVersionSession: ArchiveSession = {
      ...mockSession,
      sittings: [
        { id: 'v1', documentId: 'doc-1', version: 1, savedAt: Date.now() - 100000 },
        { id: 'v2', documentId: 'doc-1', version: 2, savedAt: Date.now() - 50000 },
        { id: 'v3', documentId: 'doc-1', version: 3, savedAt: Date.now() },
      ],
    };

    renderPreview(multiVersionSession);

    await waitFor(() => {
      expect(screen.getByText('3 версии')).toBeInTheDocument();
    });
  });

  it('S-6: refuses export and shows refusal toast when session content is not loaded', async () => {
    const exportTxtSpy = vi.spyOn(ArchiveExportService, 'exportAsTxt');
    const unloadedSession: ArchiveSession = {
      ...mockSession,
      content: '',
      _contentNotLoaded: true,
    };

    renderPreview(unloadedSession);

    const exportTrigger = screen.getByTitle(/Экспортировать|Export/);
    fireEvent.click(exportTrigger);

    const txtOption = await screen.findByText('TXT');
    fireEvent.click(txtOption);

    await waitFor(() => {
      expect(screen.getByText(/Текст заметки ещё не загружен|Содержимое недоступно|archive_no_content/)).toBeInTheDocument();
    });
    expect(exportTxtSpy).not.toHaveBeenCalled();
  });

  it('renders breadcrumb with context and calls onClose when clicking breadcrumb root (UI-04)', async () => {
    const mockClose = vi.fn();
    renderWithProviders(
      <ToastProvider>
        <DocumentPreview
          session={mockSession}
          onClose={mockClose}
          onContinue={vi.fn()}
          context="Работа"
        />
      </ToastProvider>
    );

    const breadcrumbRoot = screen.getByRole('button', { name: /Архив|Archive/i });
    expect(breadcrumbRoot).toBeInTheDocument();
    expect(screen.getByText('Работа')).toBeInTheDocument();

    fireEvent.click(breadcrumbRoot);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
