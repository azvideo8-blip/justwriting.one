import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomStats } from '../BottomStats';

const settings = {
  isZenActive: false,
  zenModeEnabled: true,
  quietStats: false,
  headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
};

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));

vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    ...settings,
    effectiveHeaderVisibility: settings.quietStats
      ? { sessionTime: false, sessionWords: false, totalWords: false, wpm: false }
      : settings.headerVisibility,
  }),
}));

vi.mock('../../store/useContentStore', () => ({
  useContentStore: (sel: (s: unknown) => unknown) =>
    sel({ wordCount: 1234, wpm: 32, content: 'x', setContent: vi.fn(), getState: () => ({ content: 'x', setContent: vi.fn() }) }),
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

describe('DC-W2: «Писать без цифр» hides the counters', () => {
  it('with quietStats on: no word count, no WPM, no «осталось»', () => {
    settings.quietStats = true;
    render(<BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    expect(screen.queryByText('header_totalWords')).not.toBeInTheDocument();
    expect(screen.queryByText('header_wpm')).not.toBeInTheDocument();
    expect(screen.queryByText('goal_time_remaining')).not.toBeInTheDocument();
  });

  it('with quietStats off: the counters are back', () => {
    settings.quietStats = false;
    render(<BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText('1234')).toBeInTheDocument();
    expect(screen.getByText('goal_time_remaining')).toBeInTheDocument();
  });
});
