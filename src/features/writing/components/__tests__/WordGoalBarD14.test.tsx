// D-14: полоса прогресса слов рисовалась по условию обратного отсчёта ВРЕМЕНИ
// (`countsDown`), а не по цели в словах. Получалось два неверных случая: при
// цели в 300 слов без цели по времени полосы слов нет, а при отсчёте времени без
// цели по словам полоса есть и меряется о несуществующей цели в 500 слов.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BottomStats } from '../BottomStats';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false,
    zenModeEnabled: false,
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, toggle: vi.fn(), hasSupport: false, isVaultActive: false, aiNoticeRemaining: null }),
}));
vi.mock('../GoalPopup', () => ({ GoalPopup: () => null }));

type TimerState = Partial<ReturnType<typeof useTimerStore.getState>>;
const setTimer = (s: TimerState) =>
  useTimerStore.setState({ status: 'writing', wordGoal: 0, sessionStartWords: 0, sessionStartSeconds: 0, ...s } as TimerState);

const renderBottom = () => render(<BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);

describe('D-14: полоса слов привязана к цели в словах', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: 'раз два', wordCount: 2 });
  });

  it('цель в 300 слов без цели по времени — подпись цели и полоса слов', () => {
    setTimer({ sessionType: 'words', wordGoal: 300, timerDuration: 1800, timeGoalExplicit: false, seconds: 1 });
    renderBottom();
    const words = screen.getByRole('button', { name: 'goal_popup_words_title' });
    expect(words.textContent).toContain('/ 300');
    expect(words.querySelector('.progress-glow'), 'полосы прогресса слов нет').not.toBeNull();
  });

  it('отсчёт времени без цели по словам — полосы слов нет, полоса времени есть', () => {
    setTimer({ sessionType: 'free', wordGoal: 0, timerDuration: 1200, timeGoalExplicit: true, seconds: 1 });
    renderBottom();
    expect(screen.getByRole('button', { name: 'goal_popup_words_title' }).querySelector('.progress-glow')).toBeNull();
    expect(screen.getByRole('button', { name: 'goal_popup_time_title' }).querySelector('.progress-glow')).not.toBeNull();
  });

  it('обычная сессия без обеих целей — ни одной полосы', () => {
    setTimer({ sessionType: 'free', wordGoal: 0, timerDuration: 1800, timeGoalExplicit: false, seconds: 1 });
    const { container } = renderBottom();
    expect(container.querySelector('.progress-glow')).toBeNull();
  });
});
