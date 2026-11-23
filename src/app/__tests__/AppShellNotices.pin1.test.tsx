import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../AppShell';
import { VAULT_PASSWORD_CONVERGED_EVENT } from '../../core/crypto/vaultEvents';
import { setAccountChangeNotice } from '../../core/auth/accountReload';

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

const showToast = vi.hoisted(() => vi.fn());
vi.mock('../../shared/components/Toast', () => ({
  useToast: () => ({ showToast }),
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
vi.mock('../../features/writing/hooks/useAutoHideCursor', () => ({ useAutoHideCursor: () => ({}) }));

// Slot for AppRoutes to render whichever screen is under test
let currentRouteContent: React.ReactNode = null;
vi.mock('../AppRoutes', () => ({
  AppRoutes: () => <div data-testid="app-routes-slot">{currentRouteContent}</div>,
}));

// PIN-1 (2026-11-21): notice выхода и событие конвергенции пароля.
// Мутации: wipe_failed тип success — красный (1); converged без события —
// красный (контроль). Харнесс — из ConnectionStatusBannerMount.
describe('PIN-1: AppShell — notice и конвергенция названы', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockAuthUser = { uid: 'u_pin1' };
    mockIsGuest = false;
    currentRouteContent = null;
  });
  afterEach(() => cleanup());

  it('wipe_failed — error-тост, не успех', async () => {
    setAccountChangeNotice('wipe_failed');
    render(<MemoryRouter initialEntries={['/']}><AppShell /></MemoryRouter>);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('settings_sign_out_notice_wipe_failed', 'error'));
    expect(showToast).not.toHaveBeenCalledWith('settings_sign_out_notice_wipe_failed', 'success');
  });

  it('account_deleted_wipe_failed — error-тост', async () => {
    setAccountChangeNotice('account_deleted_wipe_failed');
    render(<MemoryRouter initialEntries={['/']}><AppShell /></MemoryRouter>);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('settings_delete_account_wipe_failed', 'error'));
  });

  it('событие конвергенции — success; без события тоста нет', async () => {
    render(<MemoryRouter initialEntries={['/']}><AppShell /></MemoryRouter>);
    expect(showToast).not.toHaveBeenCalledWith('enc_password_converged', 'success');
    window.dispatchEvent(new Event(VAULT_PASSWORD_CONVERGED_EVENT));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('enc_password_converged', 'success'));
  });

  it('контроль: notice нет — тостов нет', async () => {
    render(<MemoryRouter initialEntries={['/']}><AppShell /></MemoryRouter>);
    await new Promise(r => setTimeout(r, 50));
    expect(showToast).not.toHaveBeenCalled();
  });
});
