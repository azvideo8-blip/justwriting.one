// MC-7: «Профиль» на телефоне — шапка без рамки, группы «Практика» и
// «Состояние» с 13 px подписями вместо карточек и mono-uppercase ярлыков.
// «Написать сейчас» убрано (решение владельца 5), сброс достижений живёт в
// настройках, а не в профиле. При нулевом стрике «0 дней» не показывается.
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

let layoutMode: 'desktop' | 'mobile' = 'mobile';
vi.mock('../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode, setLayoutMode: vi.fn() }),
}));

vi.mock('../../../features/profile/hooks/useProfileStats', () => ({
  useProfileStats: () => ({ status: 'empty' }),
  EMPTY_PROFILE_STATS: { sessions: [], kpiStats: {} },
}));
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
vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, c: number) => `${k}:${c}`, language: 'ru', setLanguage: vi.fn() }),
}));

function renderScreen(streakDays: number, createdDaysAgo: number) {
  const created = Date.now() - createdDaysAgo * 24 * 60 * 60 * 1000;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <MobileMeScreen
          user={{ uid: 'u1', email: 'a@b.c', metadata: { creationTime: created } } as never}
          profile={{ streakDays } as never}
        />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('MC-7: «Профиль» без карточек-в-карточке', () => {
  it('группы «Практика» и «Состояние» есть, «Написать сейчас» и сброса достижений — нет', () => {
    cleanup();
    renderScreen(3, 92);

    expect(screen.getByText('me_group_practice')).toBeInTheDocument();
    expect(screen.getByText('me_group_state')).toBeInTheDocument();
    expect(screen.queryByText(/profile_cta/), 'в профиле осталась кнопка «Написать сейчас»').toBeNull();
    expect(screen.queryByText(/profile_ach_reset/), 'сброс достижений остался в профиле').toBeNull();
    expect(screen.getByText(/me_streak_row/)).toBeInTheDocument();
  });

  it('при нулевом стрике нет «0 дней» и строки серии', () => {
    cleanup();
    renderScreen(0, 92);
    expect(screen.queryByText(/:0/), 'в профиле показан нулевой счётчик').toBeNull();
    expect(screen.queryByText(/me_streak_row/)).toBeNull();
  });

  it('первый день практики называется первым днём, а не «0 дней»', () => {
    cleanup();
    renderScreen(1, 0);
    expect(screen.getByText('me_first_entry_today')).toBeInTheDocument();
    expect(screen.queryByText(/:0/), 'практика показана как ноль дней').toBeNull();
  });
});
