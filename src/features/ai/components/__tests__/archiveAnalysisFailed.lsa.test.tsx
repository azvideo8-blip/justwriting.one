// 0.11.22: массовый разбор — упавшие заметки не показывались; все упали —
// «Разбирать было нечего» зелёным. Мутации: убрать ветку `analyzed === 0 &&
// failed > 0` — красный (1); тип всегда 'success' при failed > 0 — красный (2).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const showToast = vi.fn();
vi.mock('../../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'ru' }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../../../../core/ai/indexingConsent', () => ({ hasIndexingConsent: () => true }));
const svc = vi.hoisted(() => ({ findPending: vi.fn(), analyzePending: vi.fn() }));
vi.mock('../../services/NoteAnalysisService', () => ({ NoteAnalysisService: svc }));

import { ArchiveAnalysisButton } from '../ArchiveAnalysisButton';

async function run(result: { analyzed: number; failed: number }) {
  svc.findPending.mockResolvedValue({ ids: ['a', 'b', 'c'], totalDocuments: 3, alreadyAnalyzed: 0, excluded: 0, tooShort: 0, noContent: 0 });
  svc.analyzePending.mockResolvedValue({ ...result, skipped: 0, missingVectors: 0, stopped: null });
  render(<ArchiveAnalysisButton />);
  fireEvent.click(screen.getByRole('button', { name: /ai_archive_analysis_btn/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'ai_archive_analysis_start' }));
  await waitFor(() => expect(showToast).toHaveBeenCalled());
}

describe('массовый разбор: упавшие названы', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });

  it('все упали — ошибка, а не «разбирать было нечего»', async () => {
    await run({ analyzed: 0, failed: 3 });
    expect(showToast).toHaveBeenCalledWith('ai_archive_analysis_all_failed', 'error');
    expect(showToast).not.toHaveBeenCalledWith('Разбирать было нечего', 'success');
  });

  it('часть упала — предупреждение с хвостом «не удалось»', async () => {
    await run({ analyzed: 2, failed: 1 });
    expect(showToast).toHaveBeenCalledWith('ai_archive_analysis_done', 'warning');
  });
});
