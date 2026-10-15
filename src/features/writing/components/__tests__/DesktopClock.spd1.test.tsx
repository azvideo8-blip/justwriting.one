// SP-D1 (= SA-5, десктоп): стор по умолчанию держит timerDuration = 30 мин в любом
// режиме, десктоп считал вниз от 30:00 с полосой. Отсчёт — только при явной цели.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BottomStats } from '../BottomStats';
import { HeaderStats } from '../HeaderStats';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';
import { sessionClockSeconds, timeGoalCountsDown } from '../../utils/sessionModeLabels';

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

const renderBottom = () =>
  render(<BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);

describe('SP-D1: desktop session clock', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: 'раз два', wordCount: 2 });
  });

  it('BottomStats: free flow without a chosen goal counts up and has no bar', () => {
    setTimer({ sessionType: 'free', timerDuration: 1800, timeGoalExplicit: false, seconds: 1 });
    const { container } = renderBottom();
    expect(screen.getAllByText(/^0?0:01$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^29:5\d$/)).toBeNull();
    expect(container.querySelector('.progress-glow')).toBeNull();
  });

  it('BottomStats: free flow with an explicit 20-min goal counts down and shows the bar', () => {
    setTimer({ sessionType: 'free', timerDuration: 1200, timeGoalExplicit: true, seconds: 1 });
    const { container } = renderBottom();
    expect(screen.getAllByText(/^19:59$/).length).toBeGreaterThan(0);
    expect(container.querySelector('.progress-glow')).not.toBeNull();
  });

  it('HeaderStats: same rule', () => {
    const props = {
      wordGoal: 0, timerDuration: 1800, onSetWordGoal: vi.fn(), onSetTimerDuration: vi.fn(),
      sessionWords: 0, sessionSeconds: 1, wordCount: 2, wpm: 0, status: 'writing' as const,
      visibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    };
    const up = render(<HeaderStats {...props} sessionType="free" timeGoalExplicit={false} />);
    expect(screen.getAllByText('0:01').length).toBeGreaterThan(0);
    expect(up.container.querySelector('.progress-glow')).toBeNull();
    up.unmount();
    const down = render(<HeaderStats {...props} timerDuration={1200} sessionType="free" timeGoalExplicit />);
    expect(screen.getAllByText('19:59').length).toBeGreaterThan(0);
    expect(down.container.querySelector('.progress-glow')).not.toBeNull();
  });

  it('phone modes keep MF-19: timer counts down, free/words count up', () => {
    expect(timeGoalCountsDown('timer', 600)).toBe(true);
    expect(timeGoalCountsDown('finish-by', 600)).toBe(true);
    expect(timeGoalCountsDown('free', 1800)).toBe(false);
    expect(timeGoalCountsDown('words', 1800, true)).toBe(false);
    expect(sessionClockSeconds('timer', 600, 1)).toBe(599);
    expect(sessionClockSeconds('free', 1800, 1)).toBe(1);
  });
});
