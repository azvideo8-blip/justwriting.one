// U-27 (решение владельца 2026-10-18, пакет 0.10.2): в «Профиле» на телефоне
// у виджета, у которого есть свой заголовок, не должно быть второго заголовка
// от группы; и виджеты не добавляют горизонтальный отступ поверх отступа страницы
// (на десктопе остаёт `md:px-9`, как в `ProfilePage`).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileMeScreen } from '../MobileMeScreen';
import { ToastProvider } from '../../../shared/components/Toast';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
}));

vi.mock('../../../features/profile/hooks/useProfileStats', () => ({
  useProfileStats: () => ({ sessions: [], kpiStats: {}, loading: false, refresh: vi.fn() }),
}));
vi.mock('../../../features/profile/components/KPIStrip', () => ({ KPIStrip: () => null }));
vi.mock('../../../features/profile/components/StreakRibbon', () => ({ StreakRibbon: () => null }));
vi.mock('../../../features/profile/components/MoodTrend', () => ({ MoodTrend: () => null }));
// Виджеты с собственным заголовком рендерим заглушками с recognizable h2,
// чтобы видеть, осталась ли обёртка группы с дублем.
vi.mock('../../../features/profile/components/Heatmap', () => ({
  Heatmap: () => <h2 data-testid="heat-h2">profile_heatmap_title</h2>,
}));
vi.mock('../../../features/profile/components/HourRhythm', () => ({
  HourRhythm: () => <h2 data-testid="rhythm-h2">profile_rhythm_title</h2>,
}));
vi.mock('../../../features/profile/components/Achievements', () => ({
  Achievements: () => <h2 data-testid="ach-h2">profile_achievements_title</h2>,
}));
vi.mock('../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => ({ status: 'synced', pendingCount: 0, aiStorePendingCount: 0, aiStoreDeadCount: 0 }) }));
vi.mock('../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) =>
    cb({ entries: [], setPanelOpen: vi.fn() }),
}));
vi.mock('../../../core/crypto/useEncryptionStore', () => ({
  useEncryptionStore: (cb: (s: { isVaultUnlocked: boolean }) => unknown) => cb({ isVaultUnlocked: true }),
}));
vi.mock('../../../features/auth/hooks/useAdminStatus', () => ({ useAdminStatus: () => ({ isAdmin: false }) }));
vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, c: number) => `${k}:${c}`, language: 'ru', setLanguage: vi.fn() }),
}));

function renderScreen() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <MobileMeScreen
          user={{ uid: 'u1', email: 'a@b.c', metadata: { creationTime: Date.now() - 92 * 864e5 } } as never}
          profile={{ streakDays: 3 } as never}
        />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('U-27: двойных заголовков в профиле нет', () => {
  it('виджеты с своим h2 не обёрнуты в группу с подписью', () => {
    cleanup();
    renderScreen();
    expect(screen.getByTestId('heat-h2')).toBeInTheDocument();
    expect(screen.getByTestId('rhythm-h2')).toBeInTheDocument();
    expect(screen.getByTestId('ach-h2')).toBeInTheDocument();
    // Подписи групп над этими тремя виджетами — дубль заголовка виджета.
    expect(screen.queryByText('profile_act_map'), 'над «Активностью» остался заголовок группы').toBeNull();
    expect(screen.queryByText('profile_rhythm'), 'над «Ритмом дня» остался заголовок группы').toBeNull();
    // «Достижения» показаны ровно один раз.
    expect(screen.getAllByText('profile_achievements_title')).toHaveLength(1);
    // Группы «Практика» и «Состояние» остаются: у их содержимого своего заголовка нет.
    expect(screen.getByText('me_group_practice')).toBeInTheDocument();
    expect(screen.getByText('me_group_state')).toBeInTheDocument();
  });
});
