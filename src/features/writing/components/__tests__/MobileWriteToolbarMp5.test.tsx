// MP-5: панель письма на телефоне показывает тот же режим, что токен режима.
// MF-3: время и слова теперь в одном чипе — проверяется его текст.
// Цель по словам — только в режиме слов, обратный отсчёт — только в таймере и
// «закончить к»; в свободном потоке и секундомере время идёт вперёд.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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

function chip(): string {
  return document.querySelector('[data-write-chip]')!.textContent ?? '';
}

function renderToolbar() {
  return render(
    <LanguageProvider>
      <MobileWriteToolbar onStop={vi.fn()} />
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
    expect(chip()).toContain('136');
    expect(chip(), 'панель показала цель слов не из своего режима').not.toContain('/100');
  });

  it('в свободном потоке время идёт вперёд, а не обратно', () => {
    renderToolbar();
    // 600 с elapsed, timerDuration 1800: обратный отсчёт дал бы «20:00».
    expect(chip()).toContain('10:00');
    expect(chip()).not.toContain('20:00');
  });

  it('в режиме слов цель показана', () => {
    timer.sessionType = 'words';
    renderToolbar();
    expect(chip()).toContain('136/100');
  });

  it('в таймере — обратный отсчёт и подпись цели', () => {
    timer.sessionType = 'timer';
    renderToolbar();
    expect(chip()).toContain('20:00');
    expect(chip(), 'в таймере показалась цель по словам').not.toContain('/100');
  });

  it('в «закончить к» — тоже обратный отсчёт', () => {
    timer.sessionType = 'finish-by';
    renderToolbar();
    expect(chip()).toContain('20:00');
  });

  it('в секундомере время идёт вперёд, цели нет', () => {
    timer.sessionType = 'stopwatch';
    renderToolbar();
    expect(chip()).toContain('10:00');
    expect(chip()).not.toContain('/100');
  });
});
