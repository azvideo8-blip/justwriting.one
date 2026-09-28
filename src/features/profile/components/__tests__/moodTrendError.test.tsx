import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MoodTrend } from '../MoodTrend';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { reportError } from '../../../../shared/errors/reportError';
import { LanguageProvider } from '../../../../shared/i18n';

vi.mock('../../../../core/services/LocalDocumentService', () => ({
  LocalDocumentService: {
    getDocumentsByOwner: vi.fn(),
  },
}));

vi.mock('../../../../shared/errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('B-5.3 (F-025) MoodTrend error handling on read failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls reportError and renders error state when read rejects', async () => {
    const error = new Error('IndexedDB read failed');
    vi.mocked(LocalDocumentService.getDocumentsByOwner).mockRejectedValue(error);

    const { container } = render(<LanguageProvider><MoodTrend userId="user_123" /></LanguageProvider>);

    // On unpatched code, it catches nothing, reportError is never called, and container is empty (null).
    expect(await screen.findByText('Не удалось загрузить данные о настроении')).toBeInTheDocument();
    expect(reportError).toHaveBeenCalledWith(error, expect.objectContaining({ action: 'MoodTrend_getDocuments' }));
    expect(container.firstChild).not.toBeNull();
  });
});
