// Главный (владелец 26.10, вместо BR-7 «обе сразу»): одна подсказка за раз.
// Есть «Продолжить» — «В этот день» не грузится и не рисуется; карточку
// возврата скрыли крестиком (до завтра) или её нет — напоминание на месте.
// Пока карточка возврата читается — напоминания нет, чтобы не мелькало.
// Во время письма, в дзене и при черновике — ни той, ни другой.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

const onThisDayArgs = vi.hoisted(() => [] as boolean[]);
const returnState = vi.hoisted(() => ({ value: undefined as unknown }));
const returnNote = { id: 'doc_ret', title: 'Запись трёхдневной давности', lastSessionAt: Date.now() - 3 * 86_400_000 };
const memorySession = {
  id: 's_mem', userId: 'guest_1', title: 'Год назад', content: 'Текст прошлогодней заметки.',
  createdAt: Date.now() - 365 * 86_400_000, duration: 60, wordCount: 5, charCount: 20, wpm: 5, tags: [], _isLocal: true,
};

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string, p?: Record<string, string | number>) => (p?.count !== undefined ? `${k}:${p.count}` : k), tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false, zenModeEnabled: false, editorWidth: 'normal', zenSeenOnce: true,
    fontFamily: 'Inter', fontSize: 18, streamMode: false, toggleStreamMode: vi.fn(),
    autoHideCursor: false, aiPanelOpen: false, setAiPanelOpen: vi.fn(), lifeLogVisible: false,
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../../../core/settings/SettingsContext', () => ({ useSettings: () => ({ openSettings: vi.fn() }) }));
vi.mock('../../../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: { setupMode: 'none', openHelp: false, setOpenHelp: vi.fn() },
    actions: {}, session: { saveStatus: 'saved', saveErrorKind: null },
    streakDays: 0, handlePlayRef: { current: null }, keystrokeTrackerRef: { current: null },
    showZen: false, reducedMotion: true,
  }),
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({ isVaultUnlocked: true, encryptionMode: 'none' }),
  useVaultStatus: () => ({ isVaultActive: false, isVaultUnlocked: true }),
}));
vi.mock('../../hooks/useReturnNote', () => ({ useReturnNote: () => returnState.value }));
vi.mock('../../hooks/useOnThisDayHome', () => ({
  useOnThisDayHome: (_uid: string, enabled: boolean) => {
    onThisDayArgs.push(enabled);
    return enabled ? memorySession : null;
  },
}));

function renderScreen(overrides: Partial<ComponentProps<typeof MobileWriteScreen>> = {}) {
  return render(
    <MobileWriteScreen
      onPlay={vi.fn()} onStop={vi.fn()} status="idle" streakDays={0}
      sessionType="free" onOpenSetup={vi.fn()} userId="u_br7"
      onContinueNote={vi.fn()} onOpenMemory={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  cleanup();
  onThisDayArgs.length = 0;
  returnState.value = returnNote;
  localStorage.clear();
  useContentStore.setState({ content: '', wordCount: 0 });
  useTimerStore.setState({ status: 'idle', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
});

describe('главный: одна подсказка за раз', () => {
  it('есть «Продолжить» — «В этот день» не грузится и не показывается', () => {
    renderScreen();
    expect(screen.getByTestId('return-to-writing')).toBeInTheDocument();
    expect(screen.queryByText('Год назад')).toBeNull();
    expect(onThisDayArgs[onThisDayArgs.length - 1]).toBe(false);
  });

  it('«Продолжить» нет — напоминание на месте', () => {
    returnState.value = null;
    renderScreen();
    expect(screen.queryByTestId('return-to-writing')).toBeNull();
    expect(screen.getByText('Год назад')).toBeInTheDocument();
  });

  it('карточка возврата ещё читается — напоминание не мелькает', () => {
    returnState.value = undefined;
    renderScreen();
    expect(screen.queryByText('Год назад')).toBeNull();
    expect(onThisDayArgs[onThisDayArgs.length - 1]).toBe(false);
  });

  it('крестик у «Продолжить» скрывает её до завтра, и появляется напоминание', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'home_return_dismiss' }));
    expect(screen.queryByTestId('return-to-writing')).toBeNull();
    expect(screen.getByText('Год назад')).toBeInTheDocument();
    // Перезапуск в тот же день — по-прежнему скрыта.
    cleanup();
    renderScreen();
    expect(screen.queryByTestId('return-to-writing')).toBeNull();
  });

  it('отметка «скрыта» — своя у каждого человека', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'home_return_dismiss' }));
    cleanup();
    renderScreen({ userId: 'u_other' });
    expect(screen.getByTestId('return-to-writing')).toBeInTheDocument();
  });

  it('вчерашняя отметка не прячет карточку сегодня', () => {
    localStorage.setItem('home_return_dismissed_u_br7', '2000-01-01');
    renderScreen();
    expect(screen.getByTestId('return-to-writing')).toBeInTheDocument();
  });

  it('идёт письмо — напоминание не грузится и не показывается', () => {
    returnState.value = null;
    useTimerStore.setState({ status: 'writing' } as Partial<ReturnType<typeof useTimerStore.getState>>);
    renderScreen({ status: 'writing' });
    expect(onThisDayArgs[onThisDayArgs.length - 1]).toBe(false);
    expect(screen.queryByText('Год назад')).toBeNull();
  });

  it('черновик в редакторе — напоминания нет', () => {
    returnState.value = null;
    renderScreen({ hasDraft: true });
    expect(onThisDayArgs[onThisDayArgs.length - 1]).toBe(false);
    expect(screen.queryByText('Год назад')).toBeNull();
  });

  it('текста заметки в напоминании нет — только название', () => {
    returnState.value = null;
    renderScreen();
    expect(screen.getByText('Год назад')).toBeInTheDocument();
    expect(screen.queryByText('Текст прошлогодней заметки.')).toBeNull();
  });
});
