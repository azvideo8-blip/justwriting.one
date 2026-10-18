// N-2 (решение владельца 2026-10-18): у гостя на телефоне вкладки «ИИ» нет,
// вместо неё справа «Войти», и она открывает ту же модалку входа, что десктоп и
// «Профиль» гостя, а не отдельную страницу. У вошедшего — прежние четыре вкладки.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomNav } from '../BottomNav';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k }),
}));

let auth: { isGuest: boolean; user: { uid: string } | null; loading?: boolean } = { isGuest: true, user: null };
const openLoginModal = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../../../app/useAuthStatus', () => ({ useAuthStatus: () => auth }));
vi.mock('../../../../app/useLoginModal', () => ({ useLoginModal: () => ({ openLoginModal }) }));
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'synced', pendingCount: 0, aiStorePendingCount: 0, aiStoreDeadCount: 0 }),
}));
vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) =>
    cb({ entries: [], setPanelOpen: vi.fn() }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function renderNav() {
  cleanup();
  navigate.mockClear();
  openLoginModal.mockClear();
  return render(
    <MemoryRouter initialEntries={['/']}>
      <BottomNav />
    </MemoryRouter>,
  );
}

describe('N-2: нижняя панель гостя', () => {
  beforeEach(() => {
    auth = { isGuest: true, user: null };
  });

  it('гость: «Писать» · «Заметки» · «Профиль» · «Войти», вкладки «ИИ» нет', () => {
    renderNav();
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label'));
    expect(names).toEqual(['nav_write', 'nav_notes_short', 'nav_profile_short', 'nav_login']);
    expect(screen.queryByRole('button', { name: 'nav_ai_short' })).toBeNull();
  });

  it('гость: «Войти» открывает модалку входа и не ведёт ни на какую страницу', () => {
    renderNav();
    const login = screen.getByRole('button', { name: 'nav_login' });
    // Та же цель, что у остальных вкладок.
    expect(login.className).toContain('min-w-16');
    fireEvent.click(login);
    expect(openLoginModal).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('вошедший: прежний набор из четырёх вкладок, «ИИ» на месте, «Войти» нет', () => {
    auth = { isGuest: false, user: { uid: 'u1' } };
    renderNav();
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label'));
    expect(names).toEqual(['nav_write', 'nav_notes_short', 'nav_ai_short', 'nav_profile_short']);
    expect(screen.queryByRole('button', { name: 'nav_login' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'nav_ai_short' }));
    expect(navigate).toHaveBeenCalledWith('/ai');
    expect(openLoginModal).not.toHaveBeenCalled();
  });

  // Приёмка 0.10.2: пока статус входа грузится, нет ни «ИИ», ни «Войти» —
  // гость не видит мелькания «ИИ». Мутация: убрать `|| loading` — красный.
  it('пока вход грузится — ни «ИИ», ни «Войти»', () => {
    auth = { isGuest: false, user: null, loading: true };
    renderNav();
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label'));
    expect(names).toEqual(['nav_write', 'nav_notes_short', 'nav_profile_short']);
  });
});
