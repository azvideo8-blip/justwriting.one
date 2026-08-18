import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { ToastProvider } from '../../../../shared/components/Toast';
import { DocumentPreview } from '../DocumentPreview';
import { NoteAnalysisService } from '../../../ai/services/NoteAnalysisService';
import { AISummaryService } from '../../../../core/services/AISummaryService';
import type { ArchiveSession } from '../../types';

vi.mock('../../../ai/services/NoteAnalysisService', () => ({
  NoteAnalysisService: {
    analyze: vi.fn(),
  },
}));

vi.mock('../../../../core/services/AISummaryService', () => ({
  AISummaryService: {
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../../ai/utils/relatedNotes', () => ({
  findRelatedNotes: vi.fn().mockResolvedValue([]),
}));

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
      />
    </ToastProvider>
  );
}

describe('DocumentPreview — AI Analysis button states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AISummaryService.get).mockResolvedValue(undefined);
  });

  it('renders "Проанализировать" button and not a spinner when note has no summary', async () => {
    renderPreview(mockSession);

    await waitFor(() => {
      expect(screen.getByText('Проанализировать')).toBeInTheDocument();
    });
    expect(screen.queryByText('анализируется…')).not.toBeInTheDocument();
  });

  it('calls NoteAnalysisService.analyze once and shows in-flight state when button is pressed', async () => {
    let resolveAnalyze: (value: { ok: true } | { ok: false; error: 'TOO_SHORT' }) => void;
    const analyzePromise = new Promise<{ ok: true } | { ok: false; error: 'TOO_SHORT' }>((resolve) => {
      resolveAnalyze = resolve;
    });
    vi.mocked(NoteAnalysisService.analyze).mockReturnValue(analyzePromise as ReturnType<typeof NoteAnalysisService.analyze>);

    renderPreview(mockSession);

    const button = await screen.findByText('Проанализировать');
    fireEvent.click(button);

    expect(NoteAnalysisService.analyze).toHaveBeenCalledTimes(1);
    expect(NoteAnalysisService.analyze).toHaveBeenCalledWith('doc-1');

    expect(await screen.findByText('анализируется…')).toBeInTheDocument();

    resolveAnalyze!({ ok: true });
  });

  it('tells the user to refresh after a successful analysis if summary is not yet loaded into view', async () => {
    vi.mocked(NoteAnalysisService.analyze).mockResolvedValue({ ok: true });

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
    vi.mocked(NoteAnalysisService.analyze).mockResolvedValue({ ok: false, error: 'TOO_SHORT' });

    renderPreview(mockSession);

    const button = await screen.findByText('Проанализировать');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getAllByText('Заметка слишком короткая для разбора').length).toBeGreaterThanOrEqual(1);
    });
  });
});
