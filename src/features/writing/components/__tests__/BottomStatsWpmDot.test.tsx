// DC-W6: скорость внизу экрана письма не должна читаться только цветом.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BottomStats } from '../BottomStats';
import { LanguageProvider } from '../../../../shared/i18n';

const state = vi.hoisted(() => ({
  wpm: 32,
  quietStats: false,
}));

vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false,
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

vi.mock('../../hooks/useGuardedSpeechInput', () => ({
  useGuardedSpeechInput: () => ({ isListening: false, toggleListening: vi.fn(), hasSupport: false }),
}));

vi.mock('../GoalPopup', () => ({ GoalPopup: () => null }));

const renderStats = () => render(
  <LanguageProvider>
    <BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />
  </LanguageProvider>
);

describe('DC-W6: слово вместо цвета', () => {
  beforeEach(() => {
    state.wpm = 32;
    state.quietStats = false;
  });

  it('32 слова в минуту — «ровно», и так же в доступном имени', () => {
    renderStats();
    expect(screen.getByText('ровно')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Скорость: 32 слова в минуту, ровно' })).toBeInTheDocument();
  });

  it('7 слов в минуту — «↓ медленно», 60 — «↑ быстро»', () => {
    state.wpm = 7;
    const { unmount } = render(<LanguageProvider><BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} /></LanguageProvider>);
    expect(screen.getByText(/медленно/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Скорость: 7 слов в минуту, медленно' })).toBeInTheDocument();
    unmount();

    state.wpm = 60;
    render(<LanguageProvider><BottomStats onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} /></LanguageProvider>);
    expect(screen.getByText(/быстро/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Скорость: 60 слов в минуту, быстро' })).toBeInTheDocument();
  });

  it('пороги — в title блока', () => {
    renderStats();
    expect(screen.getByTitle('меньше 15 — медленно, 15–49 — ровно, от 50 — быстро')).toBeInTheDocument();
  });

  it('при нулевой скорости слова нет, но цифра на месте', () => {
    state.wpm = 0;
    renderStats();
    expect(screen.queryByText(/медленно|ровно|быстро/)).toBeNull();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('«Писать без цифр» прячет и слово (DC-W2)', () => {
    state.quietStats = true;
    renderStats();
    expect(screen.queryByText('ровно')).toBeNull();
  });
});
