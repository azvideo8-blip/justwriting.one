import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { reportError } from '../../errors/reportError';

vi.mock('../../errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('B-3.1 (F-018) Failed lazy translation chunk does not block render and retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children with core translations when a namespace chunk fails, and updates once retry succeeds', async () => {
    const {
      LanguageProvider,
      useLanguage,
      _setForceAsyncReadyForTesting,
      _resetTranslationsForTesting,
      _retryNamespaceForTesting,
    } = await import('../index');

    _setForceAsyncReadyForTesting(true);

    let failFirstAttempt = true;
    const mockSettingsLoader = vi.fn(async () => {
      if (failFirstAttempt) {
        throw new Error('ChunkLoadError: failed to fetch chunk');
      }
      return {
        test_lazy_key: {
          ru: 'Переведённая строка настроек',
          en: 'Translated settings string',
        },
      };
    });

    await _resetTranslationsForTesting([
      { name: 'settings', load: mockSettingsLoader },
    ]);

    function ChildComponent() {
      const { t } = useLanguage();
      return (
        <div>
          <span data-testid="child-content">First screen child content</span>
          <span data-testid="lazy-key">{t('test_lazy_key')}</span>
        </div>
      );
    }

    render(
      <LanguageProvider>
        <ChildComponent />
      </LanguageProvider>
    );

    // 1. Children MUST render even though lazy namespace failed to load (no white screen)
    await waitFor(() => {
      expect(screen.getByTestId('child-content')).toHaveTextContent('First screen child content');
    }, { timeout: 2000 });

    // Key falls back to key name since settings failed
    expect(screen.getByTestId('lazy-key')).toHaveTextContent('test_lazy_key');

    // reportError was called for the failed namespace
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('failed to fetch chunk') }),
      expect.objectContaining({ action: expect.stringContaining('settings') }),
    );

    // 2. Retry succeeds
    failFirstAttempt = false;
    let retryOk = false;
    const { act } = await import('@testing-library/react');
    await act(async () => {
      retryOk = await _retryNamespaceForTesting('settings');
    });
    expect(retryOk).toBe(true);

    // 3. UI re-renders and the key from that namespace renders translated!
    await waitFor(() => {
      expect(screen.getByTestId('lazy-key')).toHaveTextContent('Переведённая строка настроек');
    });

    _setForceAsyncReadyForTesting(false);
  });
});
