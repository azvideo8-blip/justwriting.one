// N-1 (SA-20): экран входа для гостя на телефоне — без боковой колонки.
// Гость ещё не выбирал макет, а рейка 64 px съедает 18 % ширины 360 и показывает
// вкладки, до которых человеку до входа нет дела. Десктопный вход не меняется.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../AppShell';

let mockIsGuest = true;
let mockAuthUser: { uid: string } | null = null;
vi.mock('../../features/auth/hooks/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: mockAuthUser, isGuest: mockIsGuest }),
}));
vi.mock('../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ user: mockAuthUser, isGuest: mockIsGuest }),
}));

let mockNarrow = true;
// Узкий экран оболочка читает через matchMedia, как и остальное приложение:
// так тест проверяет поведение, а не наличие хука.
vi.mocked(window.matchMedia).mockImplementation(((query: string) => ({
  matches: query.includes('max-width') ? mockNarrow : false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})) as unknown as typeof window.matchMedia);

vi.mock('../../features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ serverUnreachable: false }),
}));
vi.mock('../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }),
}));
vi.mock('../../shared/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
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
let mockLayout: 'desktop' | 'mobile' = 'desktop';
vi.mock('../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: mockLayout, mobilePreferred: mockNarrow }),
}));
vi.mock('../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k }),
}));
vi.mock('../../core/settings/WritingSettingsContext', () => ({
  useWritingSettings: () => ({
    isZenActive: false, zenModeEnabled: false, silenceMode: false,
  }),
}));
vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    AnimatePresence: ({ children }: any) => <>{children}</>,
    motion: { div: ({ children, className, ...props }: any) => <div className={className} {...props}>{children}</div> },
    useReducedMotion: () => false,
  };
});
vi.mock('../../features/navigation/components/Sidebar', () => ({ Sidebar: () => <nav data-testid="sidebar" /> }));
vi.mock('../../features/navigation/components/BottomNav', () => ({ BottomNav: () => <nav data-testid="bottom-nav" /> }));
vi.mock('../../core/theme/ThemeBackground', () => ({ ThemeBackground: () => null }));
vi.mock('../../features/auth/components/LoginModalOverlay', () => ({ LoginModalOverlay: () => null }));
vi.mock('../../features/auth/components/RecoveryCodeGate', () => ({ RecoveryCodeGate: () => null }));
vi.mock('../../features/auth/components/GuestMigrationGate', () => ({ GuestMigrationGate: () => null }));
vi.mock('../../shared/components/ConfirmDialog', () => ({
  ConfirmDialogRenderer: () => null,
  useConfirmDialog: () => ({ confirm: async () => true, alert: async () => {}, prompt: async () => null }),
}));
vi.mock('../ActivityLogBadge', () => ({ ActivityLogBadge: () => null }));
vi.mock('../AppRoutes', () => ({ AppRoutes: () => <div data-testid="app-routes-slot" /> }));

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AppShell /></MemoryRouter>);
}

function sidebar() { return screen.queryByTestId('sidebar'); }
function bottomNav() { return screen.queryByTestId('bottom-nav'); }

describe('N-1 · гость на телефоне без навигации', () => {
  beforeEach(() => {
    mockIsGuest = true;
    mockAuthUser = null;
    mockNarrow = true;
    mockLayout = 'desktop';
  });

  it('гость на узком экране: /login без боковой колонки и без нижней панели', () => {
    renderAt('/login');
    expect(sidebar(), 'гость на 360 px получил десктопную рейку').toBeNull();
    expect(bottomNav()).toBeNull();
  });

  it('гость на узком экране: страница сброса пароля тоже без колонки', () => {
    renderAt('/reset-password');
    expect(sidebar()).toBeNull();
  });

  it('широкий экран: десктопный вход не меняется — рейка на месте', () => {
    mockNarrow = false;
    renderAt('/login');
    expect(sidebar(), 'на десктопе сайдбар обязан остаться').not.toBeNull();
  });

  it('вошедший без права на мобильный макет остаётся на рейке даже на узком экране', () => {
    mockIsGuest = false;
    mockAuthUser = { uid: 'user_n1_signed_in' };
    renderAt('/');
    expect(sidebar(), 'право mobile_layout_allowed здесь ни при чём — не трогаем').not.toBeNull();
    expect(bottomNav()).toBeNull();
  });

  it('вошедший с мобильным макетом получает нижнюю панель', () => {
    mockIsGuest = false;
    mockAuthUser = { uid: 'user_n1_signed_in' };
    mockLayout = 'mobile';
    renderAt('/');
    expect(bottomNav()).not.toBeNull();
    expect(sidebar()).toBeNull();
  });

  it('гость на широком экране письма остаётся на десктопной рейке', () => {
    mockNarrow = false;
    renderAt('/');
    expect(sidebar()).not.toBeNull();
    expect(bottomNav()).toBeNull();
  });
});
