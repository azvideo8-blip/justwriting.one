// MC-1: панель письма. В idle — ровно три цели: токен режима, микрофон, «Готово»
// словом (выключена). Кнопки запуска нет: первую сессию начинает первая буква
// (MR-6). В работе остаются цель по словам (контракт MP-5), пауза и активное
// «Готово», туда же возвращается переключатель ИИ.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MobileWriteToolbar } from '../MobileWriteToolbar';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, toggle: vi.fn(), hasSupport: true, isVaultActive: false, aiNoticeRemaining: null }),
}));

function names(): string[] {
  return screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent!.trim());
}

describe('MC-1: панель письма в idle и в работе', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: '', wordCount: 0, wpm: 10, wpmHistory: [] });
    useTimerStore.setState({
      status: 'idle', sessionType: 'free', seconds: 0, wordGoal: 1000, timerDuration: 0,
      sessionStartWords: 0, sessionStartSeconds: 0,
    } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  it('idle: три цели, запуск и ИИ-переключатель убраны, цели по словам нет', () => {
    render(<MobileWriteToolbar onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'writing_mode_token' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'writing_done' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'play' }), 'в idle осталась кнопка «Начать»').toBeNull();
    expect(screen.queryByRole('button', { name: 'ai_toggle' }), 'в idle остался переключатель ИИ').toBeNull();
    expect(screen.queryByText(/\/1000/), 'в idle показана цель по словам').toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(names()).toContain('writing_mode_token');
  });

  it('idle: тап по токену режима открывает настройку сессии', () => {
    const onOpenSetup = vi.fn();
    render(<MobileWriteToolbar onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} onOpenSetup={onOpenSetup} />);
    fireEvent.click(screen.getByRole('button', { name: 'writing_mode_token' }));
    expect(onOpenSetup).toHaveBeenCalledTimes(1);
  });

  it('в работе с целью по словам: цель на месте, пауза есть, «Готово» активна, ИИ вернулся', () => {
    useContentStore.setState({ wordCount: 36 });
    useTimerStore.setState({
      status: 'writing', sessionType: 'words', seconds: 120, wordGoal: 1000, sessionStartWords: 0,
    } as Partial<ReturnType<typeof useTimerStore.getState>>);
    render(<MobileWriteToolbar onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText(/\/1000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'writing_done' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'ai_toggle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'play' })).toBeNull();
  });

  it('«Готово» — текстовая пилюля 44 px, а не иконка', () => {
    render(<MobileWriteToolbar onPlay={vi.fn()} onPause={vi.fn()} onStop={vi.fn()} />);
    const done = screen.getByRole('button', { name: 'writing_done' });
    expect(done.className).toContain('min-h-11');
    expect(done.textContent).toBe('writing_done');
    expect(done.querySelector('svg')).toBeNull();
  });
});
