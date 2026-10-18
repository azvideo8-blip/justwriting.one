// U-35 (решение владельца 2026-10-18, Q-6): активная вкладка нижней панели —
// плашка-инверсия, как активный пункт боковой панели десктопа (`Sidebar.tsx:42-51`),
// а не просто жирная подпись.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomNav } from '../BottomNav';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k }),
}));
vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => ({ isGuest: false, user: { uid: 'u1' } }) }));
vi.mock('../../../../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal: vi.fn() }) }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'synced', pendingCount: 0, aiStorePendingCount: 0, aiStoreDeadCount: 0 }),
}));
vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) =>
    cb({ entries: [], setPanelOpen: vi.fn() }),
}));

function renderNav(path: string) {
  cleanup();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>,
  );
}

describe('U-35: активная вкладка — плашка-инверсия', () => {
  it('у активной вкладки есть подложка `bg-text-main`, а текст инвертирован', () => {
    const { container } = renderNav('/archive');
    const active = screen.getByRole('button', { name: 'nav_notes_short' });
    expect(active).toHaveAttribute('aria-current', 'page');
    const plate = active.querySelector('span[aria-hidden="true"].bg-text-main');
    expect(plate, 'у активной вкладки нет плашки-инверсии').toBeTruthy();
    expect(plate?.className).toContain('inset-0');
    expect(active.className).toContain('text-surface-base');
    // Подложка не должна съедать подпись и значок: они лежат над ней.
    expect(active.querySelectorAll('.relative.z-10').length).toBeGreaterThanOrEqual(2);
    // Цель касания не уменьшилась.
    expect(active.className).toContain('min-w-16');
    expect(container.textContent).toContain('nav_notes_short');
  });

  it('у неактивных вкладок плашки нет, цвет прежний', () => {
    renderNav('/archive');
    const inactive = screen.getByRole('button', { name: 'nav_write' });
    expect(inactive).not.toHaveAttribute('aria-current');
    expect(inactive.querySelector('span[aria-hidden="true"].bg-text-main')).toBeNull();
    expect(inactive.className).toContain('text-text-main/60');
  });
});
