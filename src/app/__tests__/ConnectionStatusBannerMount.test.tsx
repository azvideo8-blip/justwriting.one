import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../AppShell';
import { DesktopWritingLayout } from '../pages/DesktopWritingLayout';
import { MobileWriteScreen } from '../../features/writing/components/MobileWriteScreen';
import { useEncryptionStore } from '../../core/crypto/useEncryptionStore';

let mockIsOnline = true;
vi.mock('../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

let mockServerUnreachable = false;
vi.mock('../../features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ serverUnreachable: mockServerUnreachable }),
}));

vi.mock('../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }),
}));

let mockAuthUser: { uid: string } | null = { uid: 'user_banner_test' };
let mockIsGuest = false;
vi.mock('../useAuthStatus', () => ({
  useAuthStatus: () => ({ user: mockAuthUser, isGuest: mockIsGuest }),
}));

vi.mock('../../features/auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({ isAdmin: false }),
}));

vi.mock('../../features/auth/hooks/useLoginModal', () => ({
  useLoginModal: () => ({ loginModalOpen: false }),
}));

vi.mock('../../core/settings/SettingsContext', () => ({
  useSettings: () => ({ openSettings: vi.fn() }),
}));

vi.mock('../../features/encryption/hooks/useEncryptionSetup', () => ({
  useEncryptionSetup: () => ({ mode: 'none', check: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('../../core/sync/useEmptyDeviceDetection', () => ({
  useEmptyDeviceDetection: () => ({ shouldPrompt: false, localCount: 0, cloudCount: 0, dismiss: vi.fn() }),
}));

vi.mock('../../features/auth/hooks/useOtherUserDetection', () => ({
  useOtherUserDetection: () => ({ hasOtherData: false, dismiss: vi.fn(), clear: vi.fn() }),
}));

vi.mock('../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

let mockLayoutMode: 'desktop' | 'mobile' = 'desktop';
vi.mock('../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: mockLayoutMode }),
}));

vi.mock('../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    // MR-6: idle-шапка письма считает стрик через tp() — без него мок падал.
    tp: (k: string) => k,
  }),
}));

let mockIsZenActive = false;
let mockZenModeEnabled = false;
vi.mock('../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: mockIsZenActive,
    zenModeEnabled: mockZenModeEnabled,
    editorWidth: 'normal',
    zenSeenOnce: true,
    lifeLogVisible: false,
    setLifeLogVisible: vi.fn(),
    lifeLogTab: 'today',
    setLifeLogTab: vi.fn(),
    lifeLogPinned: false,
    setLifeLogPinned: vi.fn(),
    silenceMode: false,
    fontFamily: 'Inter',
    fontSize: 18,
    streamMode: false,
    toggleStreamMode: vi.fn(),
    headerVisibility: { sessionTime: true, sessionWords: true, totalWords: true, wpm: true },
  }),
}));

vi.mock('../../features/writing/contexts/WritingSessionContext', () => ({
  useWritingSessionContext: () => ({
    flow: { setupMode: 'none', openHelp: false, setOpenHelp: vi.fn() },
    actions: {},
    session: { saveStatus: 'saved', saveErrorKind: null },
    streakDays: 7,
    handlePlayRef: { current: null },
    keystrokeTrackerRef: { current: null },
    showZen: mockIsZenActive && mockZenModeEnabled,
    reducedMotion: false,
    handleNew: vi.fn(),
    handleOpenLog: vi.fn(),
    handleSave: vi.fn(),
    handlePlay: vi.fn(),
    handlePause: vi.fn(),
    handleStop: vi.fn(),
    totalDurationForDeadline: 0,
  }),
}));

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    motion: {
      div: ({ children, className, ...props }: any) => (
        <div className={className} {...props}>{children}</div>
      ),
    },
    useReducedMotion: () => false,
  };
});

// Mock child components of screens to isolate layout & banner mounts
vi.mock('../../features/navigation/components/Sidebar', () => ({ Sidebar: () => <nav data-testid="sidebar" /> }));
vi.mock('../../features/navigation/components/BottomNav', () => ({ BottomNav: () => <nav data-testid="bottom-nav" /> }));
vi.mock('../../core/theme/ThemeBackground', () => ({ ThemeBackground: () => null }));
vi.mock('../../features/auth/components/LoginModalOverlay', () => ({ LoginModalOverlay: () => null }));
vi.mock('../../features/auth/components/RecoveryCodeGate', () => ({ RecoveryCodeGate: () => null }));
vi.mock('../../features/auth/components/GuestMigrationGate', () => ({ GuestMigrationGate: () => null }));
vi.mock('../../shared/components/ConfirmDialog', () => ({ ConfirmDialogRenderer: () => null, useConfirmDialog: () => ({ confirm: async () => true, alert: async () => {}, prompt: async () => null }) }));
vi.mock('../ActivityLogBadge', () => ({ ActivityLogBadge: () => null }));

// Mock DesktopWritingLayout children
vi.mock('../../features/writing/components/WritingHeader', () => ({ WritingHeader: () => <div data-testid="writing-header" /> }));
vi.mock('../../features/writing/components/WritingEditor', () => ({ WritingEditor: () => <div data-testid="writing-editor" /> }));
vi.mock('../../features/writing/components/WritingSetup', () => ({ WritingSetup: () => <div data-testid="writing-setup" /> }));
vi.mock('../../features/writing/components/LifeLogPanel', () => ({ LifeLogPanel: () => <div data-testid="life-log-panel" /> }));
vi.mock('../../features/writing/components/BottomStats', () => ({ BottomStats: () => <div data-testid="bottom-stats" /> }));
vi.mock('../../features/writing/components/SaveStatus', () => ({ SaveStatus: () => null }));
vi.mock('../../features/ai/components/AIPanel', () => ({ AIPanelContent: () => null }));

// Mock MobileWriteScreen children
vi.mock('../../features/writing/components/MobileFocusScreen', () => ({ MobileFocusScreen: () => null }));
vi.mock('../../features/writing/components/MobileWriteToolbar', () => ({ MobileWriteToolbar: () => null }));
vi.mock('../../features/writing/components/MobileGoalSheet', () => ({ MobileGoalSheet: () => null }));
vi.mock('../../features/writing/hooks/useAutoHideCursor', () => ({ useAutoHideCursor: () => ({}) }));

// Slot for AppRoutes to render whichever screen is under test
let currentRouteContent: React.ReactNode = null;
vi.mock('../AppRoutes', () => ({
  AppRoutes: () => <div data-testid="app-routes-slot">{currentRouteContent}</div>,
}));

describe('AG-2: ConnectionStatusBanner deduplication', () => {
  const userId = 'user_banner_test';

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOnline = true;
    mockServerUnreachable = false;
    mockAuthUser = { uid: userId };
    mockIsGuest = false;
    mockIsZenActive = false;
    mockZenModeEnabled = false;
    // Set vault as enabled and locked so ConnectionStatusBanner renders role="status"
    useEncryptionStore.setState({
      isVaultUnlocked: false,
      encryptionEnabled: { [userId]: true },
    });
  });

  it('renders exactly one role="status" banner on desktop writing screen', () => {
    mockLayoutMode = 'desktop';
    currentRouteContent = <DesktopWritingLayout />;

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>
    );

    const banners = screen.getAllByRole('status');
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent('vault_locked_banner');
  });

  it('hides the banner on desktop writing screen in zen mode', () => {
    mockLayoutMode = 'desktop';
    mockIsZenActive = true;
    mockZenModeEnabled = true;
    currentRouteContent = <DesktopWritingLayout />;

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>
    );

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders exactly one role="status" banner on mobile home screen', () => {
    mockLayoutMode = 'mobile';
    currentRouteContent = (
      <MobileWriteScreen
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onStop={vi.fn()}
      />
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>
    );

    const banners = screen.getAllByRole('status');
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent('vault_locked_banner_compact');
  });

  it('renders exactly one role="status" banner on mobile write screen', () => {
    mockLayoutMode = 'mobile';
    currentRouteContent = (
      <MobileWriteScreen
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onStop={vi.fn()}
      />
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>
    );

    const banners = screen.getAllByRole('status');
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent('vault_locked_banner_compact');
  });

  it('hides the banner on mobile write screen in zen mode', () => {
    mockLayoutMode = 'mobile';
    mockIsZenActive = true;
    mockZenModeEnabled = true;
    currentRouteContent = (
      <MobileWriteScreen
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onStop={vi.fn()}
      />
    );

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppShell />
      </MemoryRouter>
    );

    expect(screen.queryByRole('status')).toBeNull();
  });
});
