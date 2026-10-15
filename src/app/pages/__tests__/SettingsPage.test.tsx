import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithProviders } from '../../../test/utils/render';
import { SettingsPage } from '../SettingsPage';
import { ThemeProvider } from '../../../core/theme/ThemeProvider';

const layout = vi.hoisted(() => ({ mode: 'desktop' as 'desktop' | 'mobile' }));
vi.mock('../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: layout.mode, setLayoutMode: vi.fn() }),
}));

vi.mock('../../../shared/components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({
    status: 'synced',
    pendingCount: 0,
    unsyncedCount: 0,
    autoSyncEnabled: true,
  }),
}));

let mockIsAuthenticated = true;
let mockIsGuest = false;

vi.mock('../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({
    isAuthenticated: mockIsAuthenticated,
    isGuest: mockIsGuest,
    user: mockIsAuthenticated ? { uid: 'test-user-123', email: 'test@example.com' } : null,
  }),
}));

let mockIsAdmin = false;
vi.mock('../../../features/auth/hooks/useAdminStatus', () => ({
  useAdminStatus: () => ({ isAdmin: mockIsAdmin, loading: false }),
}));

vi.mock('../../../app/AuthService', () => ({
  AuthService: {
    getCurrentUser: () => (mockIsAuthenticated ? { uid: 'test-user-123', email: 'test@example.com', displayName: 'Test User' } : null),
    deleteAccount: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('../../../core/services/EncryptionService', () => ({
  hasVault: vi.fn().mockReturnValue(false),
  EncryptionService: {
    isConfigured: vi.fn().mockResolvedValue(true),
    isUnlocked: vi.fn().mockReturnValue(false),
    needsMigration: vi.fn().mockResolvedValue(false),
    countUnencrypted: vi.fn().mockResolvedValue(0),
    changePassword: vi.fn(),
  },
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    mockIsAdmin = false;
    layout.mode = 'desktop';
    vi.clearAllMocks();
    sessionStorage.clear();
    mockIsAuthenticated = true;
    mockIsGuest = false;
  });

  it('renders all sections for authenticated user', async () => {
    renderWithProviders(
      <MemoryRouter>
        <ThemeProvider>
          <SettingsPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Настройки|Settings/);

    // Section 1: Account
    expect(screen.getAllByText('test@example.com').length).toBeGreaterThanOrEqual(1);

    // Section 2: Sync — заголовок раздела рисует страница, внутри карточки его
    // больше нет, поэтому проверяем по заголовку раздела, а не по подписи блока.

    // Заголовки разделов проверяем по роли: те же слова теперь есть и в
    // оглавлении слева, и обычный поиск по тексту находит их дважды.
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent ?? '');
    for (const expected of [/Синхронизация|Sync/, /Безопасность|Security/, /Резервная копия|Backup/, /О приложении|About/, /Удаление аккаунта|Delete account/]) {
      expect(headings.some(h => expected.test(h))).toBe(true);
    }
  });

  // MF-10: на телефоне у /settings есть путь назад — «‹ Профиль»; на десктопе нет.
  it('mobile: a «‹ Профиль» back control; desktop: none', () => {
    layout.mode = 'mobile';
    const { unmount } = renderWithProviders(
      <MemoryRouter><ThemeProvider><SettingsPage /></ThemeProvider></MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /^Профиль$|^Profile$/ })).toBeInTheDocument();
    unmount();
    layout.mode = 'desktop';
    renderWithProviders(<MemoryRouter><ThemeProvider><SettingsPage /></ThemeProvider></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /^Профиль$|^Profile$/ })).toBeNull();
  });

  it('triggers diagnostics easter egg after 5 taps on version', async () => {
    // D-16: режим диагностики — только для администратора.
    mockIsAdmin = true;
    renderWithProviders(
      <MemoryRouter>
        <ThemeProvider>
          <SettingsPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const versionBtn = screen.getByRole('button', { name: /Версия/i });
    expect(versionBtn).toBeInTheDocument();

    // Tap 5 times
    for (let i = 0; i < 5; i++) {
      fireEvent.click(versionBtn);
    }

    await waitFor(() => {
      expect(sessionStorage.getItem('diagnostics_unlocked')).toBe('true');
      expect(screen.getByText(/Открыть диагностику|Open diagnostics/)).toBeInTheDocument();
    });
  });

  it('renders guest mode appropriately without account deletion', async () => {
    mockIsAuthenticated = false;
    mockIsGuest = true;

    renderWithProviders(
      <MemoryRouter>
        <ThemeProvider>
          <SettingsPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    // Sign in button is shown for guests
    expect(screen.getAllByRole('button', { name: /Войти|Sign In/i }).length).toBeGreaterThanOrEqual(1);

    // Delete account section is absent for guests
    expect(screen.queryByText(/Удалить аккаунт навсегда|Delete account permanently/)).not.toBeInTheDocument();
  });
});
