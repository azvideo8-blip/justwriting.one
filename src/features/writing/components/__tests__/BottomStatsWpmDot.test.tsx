// Скорость внизу экрана письма — цифра и одноцветная фиолетовая точка. Оценки
// «медленно/ровно/быстро» словом и цветом (DC-W6) владелец убрал 2026-09-30.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomStats } from '../BottomStats';
import { LanguageProvider } from '../../../../shared/i18n';

const state = vi.hoisted(() => ({
  wpm: 32,
  quietStats: false,
  isZenActive: false,
}));

vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: state.isZenActive,
    zenModeEnabled: true,
    quietStats: state.quietStats,
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    effectiveHeaderVisibility: state.quietStats
      ? { sessionTime: false, sessionWords: false, totalWords: false, wpm: false }
      : { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));

vi.mock('../../store/useContentStore', () => ({
  useContentStore: (sel: (s: unknown) => unknown) =>
    sel({ wordCount: 400, wpm: state.wpm, content: 'x', setContent: vi.fn(), getState: () => ({ content: 'x', setContent: vi.fn() }) }),
  getState: () => ({ content: 'x', setContent: vi.fn() }),
}));

vi.mock('../../store/useTimerStore', () => ({
  useTimerStore: (sel: (s: unknown) => unknown) =>
    sel({
      status: 'writing', seconds: 120, wordGoal: 0, timerDuration: 1800,
      sessionStartWords: 0, sessionStartSeconds: 0,
      setWordGoal: vi.fn(), setTimerDuration: vi.fn(),
      getState: () => ({ status: 'writing' }),
    }),
  getState: () => ({ status: 'writing' }),
}));

// D-4: BottomStats читает состояние диктовки из useDictation — мок переезжает на
// него, ассерты не меняются.
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({
    isListening: false,
    toggle: vi.fn(),
    hasSupport: false,
    isVaultActive: false,
    aiNoticeRemaining: null,
  }),
}));

vi.mock('../GoalPopup', () => ({ GoalPopup: () => null }));

const renderStats = () => render(
  <LanguageProvider>
    <BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />
  </LanguageProvider>
);

describe('скорость: цифра и фиолетовая точка', () => {
  beforeEach(() => {
    state.wpm = 32;
    state.quietStats = false;
    state.isZenActive = false;
  });

  it.each([7, 32, 60])('%i слов в минуту — без оценки словом, точка фирменного цвета', wpm => {
    state.wpm = wpm;
    const { container } = renderStats();
    expect(screen.queryByText(/медленно|ровно|быстро/)).toBeNull();
    expect(screen.getByText(String(wpm))).toBeInTheDocument();
    const dot = container.querySelector('.rounded-full.w-2.h-2');
    expect(dot?.className).toContain('bg-brand-soft');
    expect(dot?.className).not.toMatch(/bg-accent-/);
  });

  it('«Писать без цифр» прячет и скорость (DC-W2)', () => {
    state.quietStats = true;
    renderStats();
    expect(screen.queryByText('32')).toBeNull();
  });
});

describe('дискета в панели кнопок', () => {
  beforeEach(() => { state.isZenActive = false; });

  it('стоит в одной группе с паузой и стопом', () => {
    render(<LanguageProvider><BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} saveStatus="saved" /></LanguageProvider>);
    const icon = screen.getByTestId('save-status');
    expect(icon.closest('.rounded-xl')?.querySelector('[aria-label="Пауза"], [aria-label="Pause"]')).not.toBeNull();
  });

  it('в дзене панель гаснет, но не при ошибке сохранения', () => {
    state.isZenActive = true;
    const { container, rerender } = render(<LanguageProvider><BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} saveStatus="saved" /></LanguageProvider>);
    expect((container.firstChild as HTMLElement).className).toContain('opacity-[0.08]');
    rerender(<LanguageProvider><BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} saveStatus="error" saveErrorKind="unknown" /></LanguageProvider>);
    expect((container.firstChild as HTMLElement).className).not.toContain('opacity-[0.08]');
  });
});
