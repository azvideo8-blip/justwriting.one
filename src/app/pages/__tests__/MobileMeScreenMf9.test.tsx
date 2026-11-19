// MR-5 → MF-9: шестерни в шапке «Профиля» больше нет; строка «Настройки»
// открывает настройки приложения (на телефоне), «Выйти» — окно подтверждения.
// Панель редактора остаётся в редакторе («Aa») и на десктопе.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileMeScreen } from '../MobileMeScreen';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const openSettings = vi.hoisted(() => vi.fn());
vi.mock('../../../core/settings/SettingsContext', () => ({ useSettings: () => ({ openSettings }) }));
vi.mock('../../../features/profile/hooks/useProfileStats', () => ({
  useProfileStats: () => ({ status: 'empty' }),
  EMPTY_PROFILE_STATS: { sessions: [], kpiStats: {} },
}));
vi.mock('../../../features/profile/components/ProfileHero', () => ({ ProfileHero: () => null }));
vi.mock('../../../features/profile/components/KPIStrip', () => ({ KPIStrip: () => null }));
vi.mock('../../../features/profile/components/StreakRibbon', () => ({ StreakRibbon: () => null }));
vi.mock('../../../features/profile/components/Heatmap', () => ({ Heatmap: () => null }));
vi.mock('../../../features/profile/components/HourRhythm', () => ({ HourRhythm: () => null }));
vi.mock('../../../features/profile/components/Achievements', () => ({ Achievements: () => null }));
vi.mock('../../../features/profile/components/MoodTrend', () => ({ MoodTrend: () => null }));
vi.mock('../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0, aiStorePendingCount: 0, aiStoreDeadCount: 0 }) }));
vi.mock('../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) =>
    cb({ entries: [], setPanelOpen: vi.fn() }),
}));
vi.mock('../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: (cb: (s: { isVaultUnlocked: boolean }) => unknown) => cb({ isVaultUnlocked: true }),
}));
vi.mock('../../../features/auth/hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: false }) }));
const layout = vi.hoisted(() => ({ mode: 'mobile' as 'mobile' | 'desktop' }));
vi.mock('../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: layout.mode, setLayoutMode: vi.fn() }) }));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../features/auth/components/SignOutConfirmModal', () => ({
  SignOutConfirmModal: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="signout-confirm" /> : null),
}));
vi.mock('../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru', setLanguage: vi.fn() }) }));

function renderScreen(user: { uid: string; email: string } | null = null) {
  return render(
    <MemoryRouter>
      <MobileMeScreen user={user as never} profile={null} />
    </MemoryRouter>,
  );
}

describe('MF-9: Profile settings and sign-out', () => {
  beforeEach(() => { navigate.mockClear(); openSettings.mockClear(); layout.mode = 'mobile'; });

  it('mobile: «Открыть» in the «Настройки» row → /settings, no editor drawer', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'settings_open_panel' }));
    expect(navigate).toHaveBeenCalledWith('/settings');
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('no gear button in the profile header', () => {
    renderScreen();
    expect(screen.queryByRole('button', { name: /nav_settings/ })).toBeNull();
  });

  it('desktop MeAccountSection still opens the editor drawer', () => {
    layout.mode = 'desktop';
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'settings_open_panel' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalledWith('/settings');
  });

  it('«Выйти» opens the sign-out confirm modal instead of navigating', () => {
    renderScreen({ uid: 'u1', email: 'u1@example.test' });
    fireEvent.click(screen.getByRole('button', { name: 'nav_logout' }));
    expect(screen.getByRole('dialog', { name: 'signout-confirm' })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith('/settings#account');
  });

  it('переключателя «Статистика / Аккаунт» больше нет', () => {
    renderScreen();
    expect(screen.queryByRole('button', { name: /me_tab_account/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /me_tab_stats/ })).toBeNull();
  });
});
