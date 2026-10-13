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
  it('каждая кнопка панели не сжимается', () => {
    const { container } = render(<MobileWriteToolbar onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const btn of buttons) {
      expect(btn.className, `кнопка «${btn.getAttribute('aria-label') ?? '?'}» может сжаться`).toContain('shrink-0');
    }
  });

  it('блоки статистики сжимаются и обрезаются, а не распирают панель', () => {
    const { container } = render(<MobileWriteToolbar onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    const words = screen.getByRole('button', { name: 'writing_mode_words' });
    const time = screen.getByRole('button', { name: 'writing_mode_timer' });
    expect(words.className).toContain('min-w-0');
    expect(words.className).toContain('overflow-hidden');
    expect(time.className).toContain('min-w-0');
    // min-h-[44px] из L-11 остаётся: сжатие не должно уменьшать цель касания.
    expect(words.className).toContain('min-h-[44px]');
    expect(time.className).toContain('min-h-[44px]');
    const html = container.innerHTML;
    // На узких экранах время уходит раньше скорости, скорость — раньше 430 px.
    expect(html).toContain('max-[379px]:hidden');
    expect(html).toContain('max-[429px]:hidden');
    expect(html).toContain('max-[399px]:hidden');
  });

  it('в дзене статистика скрыта, а кнопки — нет', () => {
    render(<MobileWriteToolbar onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} hideStats />);
    expect(screen.getByRole('button', { name: 'stop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'writing_mode_words' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'writing_mode_timer' })).toBeNull();
  });
});
