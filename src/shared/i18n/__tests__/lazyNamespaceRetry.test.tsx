import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { reportError } from '../../errors/reportError';

vi.mock('../../errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('B-3.1 (F-018) Failed lazy translation chunk does not block render and retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Фейковые таймеры и флаг асинхронной готовности не должны перетекать
    // в следующий тест.
    vi.useRealTimers();
    const { _setForceAsyncReadyForTesting } = await import('../index');
    _setForceAsyncReadyForTesting(false);
  });

  it('встроенный ретрай делает три попытки и останавливается, а не молотит сеть', async () => {
    vi.useFakeTimers();
    const { _resetTranslationsForTesting } = await import('../index');

    const loader = vi.fn(async () => {
      throw new Error('ChunkLoadError: 503');
    });

    await _resetTranslationsForTesting([{ name: 'settings', load: loader }]);
    expect(loader, 'первая попытка при старте').toHaveBeenCalledTimes(1);

    // Backoff: 1s, 2s, 4s … Если счётчик попыток не доходит до мока, цикл
    // повторяется вечно — сеть молотится пока открыта вкладка.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(5000);
    }

    expect(loader, 'ретраев не больше трёх всего').toHaveBeenCalledTimes(3);
    expect(reportError).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('событие online будит ретрай провалившегося чанка', async () => {
    vi.useFakeTimers();
    const { _resetTranslationsForTesting } = await import('../index');

    let failures = 0;
    const loader = vi.fn(async () => {
      failures++;
      if (failures <= 4) throw new Error('ChunkLoadError: offline');
      return { online_key: { ru: 'Строка после online', en: 'String after online' } };
    });

    await _resetTranslationsForTesting([{ name: 'settings', load: loader }]);
    const before = loader.mock.calls.length;

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(loader.mock.calls.length, 'online будит ретрай').toBeGreaterThan(before);
    expect(loader, 'чанка дождался успешной загрузки').toHaveReturned();

    // Выздоровевший чанк больше не дёргается: таймеры после успеха молчат.
    const settled = loader.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(loader.mock.calls.length, 'после загрузки ретраев больше нет').toBe(settled);
    vi.useRealTimers();
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

    // Ключ остаётся ключом: чанк не дошёл.
    expect(screen.getByTestId('lazy-key')).toHaveTextContent('test_lazy_key');

    // 2. Retry succeeds
    failFirstAttempt = false;
    let retryOk = false;
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
