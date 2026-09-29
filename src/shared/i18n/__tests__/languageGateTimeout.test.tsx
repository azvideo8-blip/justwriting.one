// D-1 (R2-013, R2-014): провайдер ждал `Promise.allSettled` по всем lazy-чанкам и
// до этого рендерил null — чанк, который никогда не резолвится (мёртвое соединение
// без RST, captive portal), оставлял приложение с пустым экраном навсегда. Плюс
// молчаливые три неудачные попытки и сброс счётчика на каждом событии `online`.
//
// Фальсификация (проверена мутациями): убрать race с FIRST_LOAD_TIMEOUT_MS —
// тест 1; вернуть reportError на первый провал — тест 2; снять onlineResetDone
// из условия в слушателе — тест 3.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { reportError } from '../../errors/reportError';
import type { Translations } from '../types';

vi.mock('../../errors/reportError', () => ({
  reportError: vi.fn(),
}));

describe('D-1 (R2-013, R2-014) язык не держит пустой экран', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('чанк, который никогда не резолвится, не оставляет пустой экран, а дойдёт — перерисует', async () => {
    vi.useFakeTimers();
    const {
      LanguageProvider,
      useLanguage,
      FIRST_LOAD_TIMEOUT_MS,
      _setForceAsyncReadyForTesting,
      _resetTranslationsForTesting,
    } = await import('../index');

    _setForceAsyncReadyForTesting(true);
    let deliver: (data: Translations) => void = () => {};
    const loader = vi.fn(() => new Promise<Translations>(resolve => { deliver = resolve; }));
    // Не ждём: обещание готовности резолвится только по таймауту.
    void _resetTranslationsForTesting([{ name: 'settings', load: loader }]);

    function Child() {
      const { t } = useLanguage();
      return <span data-testid="key">{t('d1_late_key')}</span>;
    }

    const { container } = render(
      <LanguageProvider><Child /></LanguageProvider>
    );
    expect(container.textContent, 'до таймаута провайдер ничего не показывает').toBe('');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_TIMEOUT_MS);
    });
    expect(screen.getByTestId('key')).toHaveTextContent('d1_late_key');

    // Дождавшийся чанк доливается и перерисовывает UI.
    await act(async () => {
      deliver({ d1_late_key: { ru: 'Дождали', en: 'Arrived' } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('key')).toHaveTextContent('Дождали');
  });

  it('о сообщении неудачи узнают один раз — когда попытки кончились, а не на первом провале', async () => {
    vi.useFakeTimers();
    const { _resetTranslationsForTesting } = await import('../index');

    const loader = vi.fn(async () => { throw new Error('ChunkLoadError: 503'); });
    await _resetTranslationsForTesting([{ name: 'settings', load: loader }]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(reportError, 'идёт первая попытка повтора — сигналить ещё рано').not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(loader).toHaveBeenCalledTimes(3);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'ChunkLoadError: 503' }),
      { action: 'i18n_lazyNamespace_load_failed', namespace: 'settings', attempts: 3 },
    );
  });

  it('online будет ретрай одного пространства один раз за загрузку страницы', async () => {
    vi.useFakeTimers();
    const { _resetTranslationsForTesting } = await import('../index');

    const loader = vi.fn(async () => { throw new Error('ChunkLoadError: offline'); });
    await _resetTranslationsForTesting([{ name: 'settings', load: loader }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(loader).toHaveBeenCalledTimes(3);

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(30_000);
    const afterFirst = loader.mock.calls.length;
    expect(afterFirst, 'первый online даёт новую серию попыток').toBeGreaterThan(3);

    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(loader.mock.calls.length, 'второй online того же пространства попыток не добавляет').toBe(afterFirst);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
