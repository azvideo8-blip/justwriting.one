// MP-5: панель письма на телефоне показывает тот же режим, что токен режима.
// Цель по словам — только в режиме слов, обратный отсчёт — только в таймере и
// «закончить к»; в свободном потоке и секундомере время идёт вперёд.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LanguageProvider } from '../../../../shared/i18n';
import { MobileWriteToolbar } from '../MobileWriteToolbar';

const timer = vi.hoisted(() => ({
  status: 'writing',
  sessionType: 'free',
  seconds: 600,
  wordGoal: 100,
  timerDuration: 1800,
  sessionStartWords: 0,
  sessionStartSeconds: 0,
}));

vi.mock('../../store/useTimerStore', () => ({
  useTimerStore: (sel: (s: unknown) => unknown) => sel(timer),
  getState: () => timer,
}));
vi.mock('../../store/useContentStore', () => ({
  useContentStore: (sel: (s: unknown) => unknown) => sel({ wordCount: 136, wpm: 20, wpmHistory: [] }),
}));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, toggle: vi.fn(), hasSupport: false, isVaultActive: true, aiNoticeRemaining: null }),
}));
vi.mock('../AIToggleButton', () => ({ AIToggleButton: () => null }));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));

function renderToolbar() {
  return render(
    <LanguageProvider>
      <MobileWriteToolbar onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} onGoalClick={vi.fn()} />
    </LanguageProvider>,
  );
}

describe('MP-5: панель письма и режим сессии', () => {
  beforeEach(() => {
    cleanup();
    Object.assign(timer, {
      status: 'writing', sessionType: 'free', seconds: 600, wordGoal: 100, timerDuration: 1800,
      sessionStartWords: 0, sessionStartSeconds: 0,
    });
  });

  it('в свободном потоке нет «/100», даже если цель стоит в настройках', () => {
    renderToolbar();
    expect(screen.getByText('136')).toBeInTheDocument();
    expect(screen.queryByText(/\/100/), 'панель показала цель слов не из своего режима').toBeNull();
  });

  it('в свободном потоке время идёт вперёд, а не обратно', () => {
    renderToolbar();
    // 600 с elapsed, timerDuration 1800: обратный отсчёт дал бы «20:00».
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.queryByText('20:00')).toBeNull();
    expect(screen.queryByText(/из 30s*мин/)).toBeNull();
  });

  it('в режиме слов цель показана', () => {
    timer.sessionType = 'words';
    renderToolbar();
    expect(screen.getByText(/\/100/)).toBeInTheDocument();
  });

  it('в таймере — обратный отсчёт и подпись цели', () => {
    timer.sessionType = 'timer';
    renderToolbar();
    expect(screen.getByText('20:00')).toBeInTheDocument();
    expect(screen.getByText(/из 30s*мин/)).toBeInTheDocument();
    expect(screen.queryByText(/\/100/), 'в таймере показалась цель по словам').toBeNull();
  });

  it('в «закончить к» — тоже обратный отсчёт', () => {
    timer.sessionType = 'finish-by';
    renderToolbar();
    expect(screen.getByText('20:00')).toBeInTheDocument();
  });

  it('в секундомере время идёт вперёд, цели нет', () => {
    timer.sessionType = 'stopwatch';
    renderToolbar();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.queryByText(/\/100/)).toBeNull();
  });
});
