// MF-3: одна спокойная панель письма — чип режима (режим · время · слова),
// микрофон и «Сохранить» дискетой. Пауза, «Новая заметка» и ИИ-помощник ушли
// в лист сессии, который открывает чип.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MobileWriteToolbar } from '../MobileWriteToolbar';
import { MobileSessionSetupSheet } from '../MobileSessionSetupSheet';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../hooks/useDictation', () => ({
  useDictation: () => ({ isListening: false, phase: 'idle', toggle: vi.fn(), hasSupport: true, isVaultActive: false, aiNoticeRemaining: 30 }),
}));

describe('MF-3: calm writing toolbar', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ wordCount: 120 });
    useTimerStore.setState({
      status: 'writing', sessionType: 'free', seconds: 192, timerDuration: 1800, wordGoal: 500,
      sessionStartWords: 0, sessionStartSeconds: 0,
    } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  it('running session: exactly three targets; the chip carries mode, time and words', () => {
    const { container } = render(<MobileWriteToolbar onStop={vi.fn()} />);
    const targets = container.querySelectorAll('button, [role="button"], [tabindex]');
    expect(targets).toHaveLength(3);
    const chip = screen.getByRole('button', { name: 'writing_mode_token' });
    expect(chip.textContent).toContain('writing_mode_flow');
    expect(chip.textContent).toContain(' 3:12');
    expect(chip.textContent).toContain('120 writing_words_short');
    expect(screen.getByRole('button', { name: 'topbar_save' })).toBeEnabled();
    // ✦ «стоит запрос» больше не висит на микрофоне (MF-5).
    expect(container.querySelector('.lucide-sparkles')).toBeNull();
  });

  it('paused: the chip says so', () => {
    useTimerStore.setState({ status: 'paused' });
    render(<MobileWriteToolbar onStop={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'writing_mode_token' }).textContent).toMatch(/⏸ pause · 3:12/);
  });

  it('the session sheet has pause, new note and the AI helper; each calls its handler and closes the sheet', () => {
    const rows = { status: 'writing' as const, hasText: true, onTogglePause: vi.fn(), onNew: vi.fn(), onOpenAI: vi.fn() };
    const setSetupMode = vi.fn();
    render(<MobileSessionSetupSheet setupMode="selection" setSetupMode={setSetupMode} startCountdown={vi.fn()} countdown={null} sessionRows={rows} />);
    fireEvent.click(screen.getByRole('button', { name: 'pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'topbar_new' }));
    fireEvent.click(screen.getByRole('button', { name: 'ai_toggle ›' }));
    expect(rows.onTogglePause).toHaveBeenCalledTimes(1);
    expect(rows.onNew).toHaveBeenCalledTimes(1);
    expect(rows.onOpenAI).toHaveBeenCalledTimes(1);
    expect(setSetupMode).toHaveBeenCalledWith(null);
  });

  it('paused session: the row reads «Продолжить»; desktop (no rows) has none of them', () => {
    const rows = { status: 'paused' as const, hasText: false, onTogglePause: vi.fn(), onNew: vi.fn(), onOpenAI: vi.fn() };
    const { unmount } = render(<MobileSessionSetupSheet setupMode="selection" setSetupMode={vi.fn()} startCountdown={vi.fn()} countdown={null} sessionRows={rows} />);
    expect(screen.getByRole('button', { name: 'writing_resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'topbar_new' })).toBeNull();
    unmount();
    render(<MobileSessionSetupSheet setupMode="selection" setSetupMode={vi.fn()} startCountdown={vi.fn()} countdown={null} />);
    expect(screen.queryByRole('button', { name: /ai_toggle/ })).toBeNull();
  });
});
