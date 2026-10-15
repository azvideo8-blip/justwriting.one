import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// MB-3 (F-2): панель письма на 320–430 px. Кнопки — приоритет, статистика
// сжимается; на узких экранах остаются слова (плюс время, если влезает) без
// подписей в 9 px. Геометрию проверяет стендовая спека
// e2e/mobile/write-toolbar-fit.mb3.spec.ts, здесь — контракт классов, который
// эту геометрию держит.
vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (key: string) => key, tp: (key: string) => key }),
}));
vi.mock('../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
  }),
}));
vi.mock('../store/useContentStore', () => ({
  useContentStore: (cb: (s: unknown) => unknown) => cb({
    wordCount: 120, wpm: 35, wpmHistory: [{ timestamp: 1, wpm: 35 }],
  }),
}));
vi.mock('../store/useTimerStore', () => ({
  useTimerStore: (cb: (s: unknown) => unknown) => cb({
    status: 'writing', seconds: 120, timerDuration: 600, wordGoal: 300,
    sessionStartSeconds: 0, sessionStartWords: 0,
  }),
}));
vi.mock('../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, toggle: vi.fn(), hasSupport: true, isVaultActive: false, aiNoticeRemaining: null, phase: 'idle' }),
}));

const { MobileWriteToolbar } = await import('../components/MobileWriteToolbar');

describe('MB-3: панель письма сжимается на статистику, а не на кнопки', () => {
  // MF-3: сжимается только чип; в нём режется название режима, а не числа.
  it('кнопки не сжимаются, чип сжимается, числа в чипе не режутся', () => {
    const { container } = render(<MobileWriteToolbar onStop={vi.fn()} />);
    const chip = container.querySelector('[data-write-chip]')!;
    expect(chip.className).toContain('min-w-0');
    expect(chip.querySelector('.truncate'), 'название режима не обрезается').toBeTruthy();
    expect(chip.querySelector('.shrink-0.whitespace-nowrap')?.textContent).toContain('2:00');
    const buttons = Array.from(container.querySelectorAll('button')).filter(b => b !== chip);
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect(btn.className, `кнопка «${btn.getAttribute('aria-label') ?? '?'}» может сжаться`).toContain('shrink-0');
    }
  });

  it('в дзене статистика скрыта, а кнопки — нет', () => {
    render(<MobileWriteToolbar onStop={vi.fn()} hideStats />);
    expect(screen.getByRole('button', { name: 'topbar_save' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'writing_mode_token' }).textContent).not.toContain('writing_words');
  });
});
