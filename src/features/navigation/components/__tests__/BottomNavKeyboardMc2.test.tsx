// MC-2: на экране письма и в чате клавиатура забирает нижнюю панель — она не
// должна стоять над клавиатурой вместе с панелью инструментов. На остальных
// экранах (например, поиск в «Заметках») панель остаётся.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomNav } from '../BottomNav';

let keyboard = { overlay: 0, up: false };
let route = '/';
let reduced = false;

vi.mock('motion/react', async (importActual) => {
  const actual = await importActual<typeof import('motion/react')>();
  return { ...actual, useReducedMotion: () => reduced };
});

vi.mock('../../../../shared/hooks/useKeyboardState', () => ({
  useKeyboardState: () => keyboard,
}));
vi.mock('../../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'mobile', setLayoutMode: vi.fn() }),
}));
vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string) => k, language: 'ru' }),
}));
vi.mock('../../../../app/useAuthStatus', () => ({
  useAuthStatus: () => ({ isGuest: false, user: { uid: 'u1' } }),
}));
vi.mock('../../../../app/useLoginModal', () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));
vi.mock('../../../../core/sync/useSyncStatus', () => ({
  useSyncStatus: () => ({ status: 'synced', pendingCount: 0 }),
}));
vi.mock('../../../../shared/activity/useActivityLogStore', () => ({
  useActivityLogStore: (cb: (s: { entries: unknown[]; setPanelOpen: (v: boolean) => void }) => unknown) =>
    cb({ entries: [], setPanelOpen: vi.fn() }),
}));
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useLocation: () => ({ pathname: route }) };
});

function renderNav() {
  return render(
    <MemoryRouter>
      <BottomNav />
    </MemoryRouter>,
  );
}

function navEl(): HTMLElement {
  // `aria-hidden` вычёркивает узел из `getByRole`, а проверять надо и скрытое
  // состояние, и класс сдвига — поэтому по testid, как в остальных мобильных
  // спеках (`data-write-toolbar`, `zen-header-row`).
  const nav = screen.getByTestId('mobile-bottom-nav');
  expect(nav).toBeTruthy();
  return nav;
}

describe('MC-2: нижняя панель и клавиатура', () => {
  beforeEach(() => {
    cleanup();
    keyboard = { overlay: 0, up: false };
    route = '/';
    reduced = false;
  });

  it('на / с поднятой клавиатурой панель убрана и скрыта от доступности', () => {
    keyboard = { overlay: 336, up: true };
    renderNav();
    const nav = navEl();
    expect(nav.getAttribute('aria-hidden')).toBe('true');
    expect(nav.className).toContain('translate-y-full');
  });

  it('без клавиатуры панель на месте', () => {
    renderNav();
    const nav = navEl();
    expect(nav.getAttribute('aria-hidden')).toBeNull();
    expect(nav.className).not.toContain('translate-y-full');
  });

  it('в чате тоже убирается', () => {
    route = '/ai';
    keyboard = { overlay: 300, up: true };
    renderNav();
    expect(navEl().getAttribute('aria-hidden')).toBe('true');
  });

  it('в «Заметках» с поднятой клавиатурой панель остаётся (решение владельца на потом)', () => {
    route = '/archive';
    keyboard = { overlay: 336, up: true };
    renderNav();
    expect(navEl().getAttribute('aria-hidden')).toBeNull();
    expect(navEl().className).not.toContain('translate-y-full');
  });

  it('переход 180 ms, при prefers-reduced-motion — мгновенно', () => {
    keyboard = { overlay: 336, up: true };
    const { container } = renderNav();
    const nav = container.querySelector('nav') as HTMLElement;
    expect(nav.style.transitionDuration).toBe('180ms');

    cleanup();
    reduced = true;
    const second = renderNav();
    expect((second.container.querySelector('nav') as HTMLElement).style.transitionDuration).toBe('0s');
  });

  // SA-8: Tailwind v4 переводит `translate-y-full` в свойство `translate`;
  // переход должен идти по тому же свойству. Мутация: вернуть 'transform' → красный.
  it('SA-8: the hide transition animates the property the class changes (translate)', () => {
    keyboard = { overlay: 300, up: true };
    route = '/';
    reduced = false;
    cleanup();
    renderNav();
    const nav = navEl();
    expect(nav.className).toContain('translate-y-full');
    expect(nav.style.transitionProperty).toBe('translate');
    expect(nav.style.transitionDuration).toBe('180ms');
  });
});
