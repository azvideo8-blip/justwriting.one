// BR-5 (ревью 25.10): гостю на телефоне показывало полосу «Не синхронизировано»
// и баннер «в облаке есть заметки». `WritingPage` передавал `session.userId`, а
// у гостя это настоящий гостевой id (`useGuestWritingSession.ts:104`) — не `null`,
// поэтому самописные guards вида `!userId` его не отсекали. На десктопе та же
// пара уже закрыта (`session.isGuest ? null : session.userId`), расходилось
// с коммитом пакета («Гостю строки нет»).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileWriteScreen } from '../MobileWriteScreen';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string, p?: Record<string, string | number>) => (p?.count !== undefined ? `${k}:${p.count}` : k), tp: (k: string) => k, language: 'ru' }),
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
// Полоса и баннер живут по этим счётчикам — гостя или нет, решает экран.
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'unsynced', unsyncedCount: 2, pendingCount: 0, autoSyncEnabled: true, loaded: true }),
}));
vi.mock('../../../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: false, localCount: 0, cloudCount: 3, showCloudBanner: true, dismiss: vi.fn(), recheck: vi.fn() }),
}));
vi.mock('../../../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));
vi.mock('../../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: () => ({ isVaultUnlocked: true, encryptionMode: 'none' }),
  useVaultStatus: () => ({ isVaultActive: false, isVaultUnlocked: true }),
}));
vi.mock('../../../../core/services/SyncService', () => ({
  SyncService: { syncPending: vi.fn().mockResolvedValue({ drained: 0, failed: 0 }) },
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

beforeEach(() => {
  cleanup();
  useContentStore.setState({ content: '', wordCount: 0 });
  useTimerStore.setState({ status: 'idle', sessionType: 'free', wordGoal: 0, timerDuration: 0, sessionStartWords: 0, sessionStartSeconds: 0 } as Partial<ReturnType<typeof useTimerStore.getState>>);
});

describe('BR-5: гостю на телефоне — ни полосы синка, ни баннера облака', () => {
  it('аккаунт: полоса и баннер есть', () => {
    renderScreen({ userId: 'u_br5' });
    expect(screen.getByTestId('sync-unsynced-bar')).toBeInTheDocument();
    expect(screen.getByTestId('cloud-notes-banner')).toBeInTheDocument();
  });

  it('гость с настоящим гостевым id: ни полосы, ни баннера', () => {
    renderScreen({ userId: 'guest_1', isGuest: true });
    expect(screen.queryByTestId('sync-unsynced-bar'), 'гостю показана полоса синка').toBeNull();
    expect(screen.queryByTestId('cloud-notes-banner'), 'гостю показан баннер облака').toBeNull();
  });
});
