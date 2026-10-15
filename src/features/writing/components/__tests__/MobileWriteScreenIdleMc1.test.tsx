// MC-1: экран письма в idle — одна строка наверху, токен режима в панели,
// «Готово» словом, кнопки «Начать» нет (первая буква уже начала сессию — MR-6).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false,
    zenModeEnabled: false,
    editorWidth: 'normal',
    zenSeenOnce: true,
    fontFamily: 'Inter',
    fontSize: 18,
    streamMode: false,
    toggleStreamMode: vi.fn(),
    autoHideCursor: false,
    aiPanelOpen: false,
    setAiPanelOpen: vi.fn(),
    lifeLogVisible: false,
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
    effectiveHeaderVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));
vi.mock('../../../../core/settings/SettingsContext', () => ({
  useSettings: () => ({ openSettings: vi.fn() }),
}));
vi.mock('../../../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: { setupMode: 'none', openHelp: false, setOpenHelp: vi.fn() },
    actions: {},
    session: { saveStatus: 'saved', saveErrorKind: null },
    streakDays: 0,
    handlePlayRef: { current: null },
    keystrokeTrackerRef: { current: null },
    showZen: false,
    reducedMotion: true,
  }),
}));
vi.mock('../../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }),
}));
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({ isVaultUnlocked: true, encryptionMode: 'none' }),
  useVaultStatus: () => ({ isVaultActive: false, isVaultUnlocked: true }),
}));

function renderScreen(overrides: Partial<ComponentProps<typeof MobileWriteScreen>> = {}) {
  return render(
    <MobileWriteScreen
      onPlay={vi.fn()}
      onStop={vi.fn()}
      status="idle"
      streakDays={0}
      sessionType="free"
      onOpenSetup={vi.fn()}
      {...overrides}
    />,
  );
}

describe('MC-1: экран письма в idle', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: '', wordCount: 0 });
    useTimerStore.setState({ status: 'idle', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
  });

  it('серии нет, если дней ноль', () => {
    renderScreen();
    expect(screen.queryByText(/home_streak_days/), 'пустая серия показана числом').toBeNull();
  });

  it('при streakDays = 3 токен серии на месте', () => {
    renderScreen({ streakDays: 3 });
    expect(screen.getByText(/home_streak_days/)).toBeInTheDocument();
  });

  it('второй строки нет: токен режима живёт в панели письма', () => {
    const { container } = renderScreen();
    const token = screen.getByRole('button', { name: 'writing_mode_token' });
    const toolbar = container.querySelector('[data-write-toolbar]');
    expect(toolbar, 'панели письма нет').toBeTruthy();
    expect(toolbar!.contains(token), 'токен режима не в панели').toBe(true);
    const area = container.querySelector('textarea');
    const above = Array.from(container.querySelectorAll('button')).filter(b =>
      !!(b.compareDocumentPosition(area!) & Node.DOCUMENT_POSITION_FOLLOWING));
    expect(above.map(b => b.getAttribute('aria-label'))).toEqual(['settings_title']);
  });

  it('кнопки «Начать» нет, «Готово» одна и выключена', () => {
    renderScreen();
    expect(screen.queryByRole('button', { name: 'play' }), 'в idle осталась кнопка запуска').toBeNull();
    const done = screen.getByRole('button', { name: 'topbar_save' });
    expect(done).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'topbar_save' })).toHaveLength(1);
  });

  it('идёт сессия — «Готово» активна', () => {
    useTimerStore.setState({ status: 'writing' } as Partial<ReturnType<typeof useTimerStore.getState>>);
    renderScreen({ status: 'writing' });
    expect(screen.getByRole('button', { name: 'topbar_save' })).not.toBeDisabled();
  });
});
