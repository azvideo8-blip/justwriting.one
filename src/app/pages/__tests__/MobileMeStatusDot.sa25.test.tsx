// SA-25: точка на вкладке «Профиль» ведёт в карточку статусов; строка, где
// что-то не так, идёт первой и объясняет словами.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileMeScreen } from '../MobileMeScreen';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../../core/settings/SettingsContext', () => ({ useSettings: () => ({ openSettings: vi.fn() }) }));
vi.mock('../../../features/profile/hooks/useProfileStats', () => ({
  useProfileStats: () => ({ sessions: [], kpiStats: {}, loading: false, refresh: vi.fn() }),
}));
for (const name of ['ProfileHero', 'KPIStrip', 'StreakRibbon', 'Heatmap', 'HourRhythm', 'Achievements', 'MoodTrend']) {
  vi.mock(`../../../features/profile/components/${name}`, () => ({ [name]: () => null }));
}
const st = vi.hoisted(() => ({ status: 'pending', unlocked: true, entries: [] as { level: string }[] }));
vi.mock('../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: st.status, pendingCount: 2, unsyncedCount: 0, aiStorePendingCount: 0, aiStoreDeadCount: 0 }),
}));
vi.mock('../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) =>
    cb({ entries: st.entries, setPanelOpen: vi.fn() }),
}));
vi.mock('../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: (cb: (s: { isVaultUnlocked: boolean }) => unknown) => cb({ isVaultUnlocked: st.unlocked }),
}));
vi.mock('../../../features/auth/hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: false }) }));
vi.mock('../../../shared/hooks/useLayoutMode', () => ({ useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }) }));
vi.mock('../../../shared/components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../../features/auth/components/SignOutConfirmModal', () => ({ SignOutConfirmModal: () => null }));
vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n: number) => `${k}:${n}`, language: 'ru', setLanguage: vi.fn() }),
}));

describe('SA-25: the profile tab dot leads to a row that says what it means', () => {
  it('a quiet sync row yields the first place to the vault row that has the dot', () => {
    st.status = 'synced'; st.unlocked = false;
    render(<MemoryRouter><MobileMeScreen user={{ uid: 'u1', email: 'a@b.c' } as never} profile={null} /></MemoryRouter>);
    const first = screen.getByTestId('status-row-warn').closest('button')!;
    expect(first.parentElement!.firstElementChild).toBe(first);
    expect(within(first).getByText('me_status_vault')).toBeInTheDocument();
    st.status = 'pending'; st.unlocked = true;
  });

  it('the row with the warning is first and its text is 13 px, not clipped', () => {
    render(<MemoryRouter><MobileMeScreen user={{ uid: 'u1', email: 'a@b.c' } as never} profile={null} /></MemoryRouter>);
    const warn = screen.getByTestId('status-row-warn');
    expect(warn.textContent).toBe('sync_pending_notes:2');
    expect(warn.className).toContain('text-[13px]');
    expect(warn.className).not.toContain('truncate');
    const first = warn.closest('button')!;
    expect(first.parentElement!.firstElementChild).toBe(first);
    expect(within(first).getByText('sync_indicator_label')).toBeInTheDocument();
  });

  // U-8: точка строки по уровню, как бейдж в Sidebar — ошибка красная.
  it('the activity row with an error has a danger dot; the sync row stays warning', () => {
    st.entries = [{ level: 'error' }];
    const { container } = render(<MemoryRouter><MobileMeScreen user={{ uid: 'u1', email: 'a@b.c' } as never} profile={null} /></MemoryRouter>);
    expect(container.querySelectorAll('.bg-accent-danger')).toHaveLength(1);
    expect(container.querySelectorAll('.bg-accent-warning')).toHaveLength(1);
    st.entries = [];
  });

  // TR-6: строка «Как всё устроено» в группе состояния, после сейфа; тихая (без точки).
  // Мутация: onTap: startTour → () => {} → красный.
  it('the tour row sits after the vault row and fires jw:tour-start', () => {
    const heard = vi.fn();
    window.addEventListener('jw:tour-start', heard);
    render(<MemoryRouter><MobileMeScreen user={{ uid: 'u1', email: 'a@b.c' } as never} profile={null} /></MemoryRouter>);
    const row = screen.getByText('tour_open').closest('button')!;
    const labels = Array.from(row.parentElement!.children).map(b => b.firstElementChild!.textContent);
    expect(labels.indexOf('tour_open')).toBeGreaterThan(labels.indexOf('me_status_vault'));
    expect(within(row).queryByTestId('status-row-warn')).toBeNull();
    fireEvent.click(row);
    window.removeEventListener('jw:tour-start', heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
