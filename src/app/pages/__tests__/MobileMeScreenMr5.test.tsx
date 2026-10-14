// MR-5: шестерёнка в «Профиле» открывает настройки приложения, а не панель
// редактора. Панель редактора остаётся только в редакторе («Aa»).
import { describe, it, expect, vi } from 'vitest';
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
vi.mock('../../profile/hooks/useProfileStats', () => ({
  useProfileStats: () => ({ sessions: [], kpiStats: {}, loading: false, refresh: vi.fn() }),
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
vi.mock('../../../shared/i18n', () => ({ useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru', setLanguage: vi.fn() }) }));

function renderScreen() {
  return render(
    <MemoryRouter>
      <MobileMeScreen user={null} profile={null} />
    </MemoryRouter>,
  );
}

describe('MR-5: шестерёнка «Профиля»', () => {
  it('ведёт в настройки приложения, а не в панель редактора', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /nav_settings/ }));
    expect(navigate).toHaveBeenCalledWith('/settings');
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('переключателя «Статистика / Аккаунт» больше нет', () => {
    renderScreen();
    expect(screen.queryByRole('button', { name: /me_tab_account/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /me_tab_stats/ })).toBeNull();
  });
});
