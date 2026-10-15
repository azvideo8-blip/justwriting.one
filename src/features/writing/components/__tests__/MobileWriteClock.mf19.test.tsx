// MF-19 (SA-5): в «Свободном потоке» часы шли вниз от 30:00 — в сторе по
// умолчанию timerDuration = 30 мин в любом режиме, а экран смотрел только на число.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
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

function run(sessionType: string, timerDuration: number, seconds: number) {
  useTimerStore.setState({ status: 'writing', sessionType, timerDuration, seconds, sessionStartSeconds: 0, sessionStartWords: 0, wordGoal: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
}

describe('MF-19: the session clock follows the mode', () => {
  beforeEach(() => {
    cleanup();
    useContentStore.setState({ content: 'раз два', wordCount: 2 });
  });

  it('free flow counts up (0:01, 0:02), not down from 30:00', () => {
    run('free', 30 * 60, 1);
    renderScreen({ status: 'writing', sessionType: 'free' });
    expect(screen.getAllByText(/^0?0:01$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^29:5\d$/)).toBeNull();
    act(() => { useTimerStore.setState({ seconds: 2 }); });
    expect(screen.getAllByText(/^0?0:02$/).length).toBeGreaterThan(0);
  });

  it('words goal counts up too', () => {
    run('words', 30 * 60, 1);
    renderScreen({ status: 'writing', sessionType: 'words' });
    expect(screen.getAllByText(/^0?0:01$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^29:5\d$/)).toBeNull();
  });

  it('timer of 10 min counts down: 9:59', () => {
    run('timer', 10 * 60, 1);
    renderScreen({ status: 'writing', sessionType: 'timer' });
    expect(screen.getAllByText(/^0?9:59$/).length).toBeGreaterThan(0);
  });
});
