// MR-4: нижняя панель — четыре вкладки, плавающих чипов нет, состояние — точкой.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomNav } from '../BottomNav';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k }),
}));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isGuest: false, user: { uid: 'u1' } }) }));
vi.mock('../../../../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));

const sync = vi.hoisted(() => ({ status: 'synced', pendingCount: 0, aiStorePendingCount: 0, aiStoreDeadCount: 0 }));
const activity = vi.hoisted(() => ({ entries: [] as { level: string; time: number }[] }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({ useSyncStatus: () => sync }));
vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) =>
    cb({ entries: activity.entries, setPanelOpen: vi.fn() }),
}));

function renderNav() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <BottomNav />
    </MemoryRouter>,
  );
}

describe('MR-4: BottomNav', () => {
  beforeEach(() => {
    sync.status = 'synced'; sync.pendingCount = 0;
    activity.entries = [];
  });

  it('вкладок всегда четыре, даже у админа; «Диагностики» в панели нет', () => {
    renderNav();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /admin_tab_diagnostics/ })).toBeNull();
  });

  it('плавающих чипов «Активность» и «Синхронизация» больше нет', () => {
    activity.entries = [{ level: 'error', time: Date.now() }];
    sync.status = 'pending'; sync.pendingCount = 3;
    renderNav();
    expect(screen.queryByRole('button', { name: /activity_log_aria/ })).toBeNull();
    expect(screen.queryByText('sync_indicator_label')).toBeNull();
  });

  it('точка на «Профиле» горит, пока есть что показать', () => {
    sync.status = 'pending'; sync.pendingCount = 2;
    const { container } = renderNav();
    expect(container.querySelector('[data-testid="tab-dot"]')).toBeTruthy();
  });

  it('при «синхронизировано» и без ошибок точки нет', () => {
    const { container } = renderNav();
    expect(container.querySelector('[data-testid="tab-dot"]')).toBeNull();
  });
});
