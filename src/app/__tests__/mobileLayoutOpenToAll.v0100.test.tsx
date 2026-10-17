import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// 0.10.0: мобильный макет открыт всем. Обычный человек и гость на телефоне
// получают его без вопроса к базе; право MB-1 (RPC `mobile_layout_allowed`)
// больше не спрашивается. Мутация: MOBILE_LAYOUT_ENABLED = false → красный.
const { state, rpc } = vi.hoisted(() => ({
  state: { uid: 'uid-regular' as string | null },
  rpc: vi.fn(),
}));

vi.mock('../../features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: state.uid === null ? null : { uid: state.uid } }),
}));
vi.mock('../../core/supabase/client', () => ({ getSupabase: () => ({ rpc }) }));
vi.mock('../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

const { MobileLayoutAccessProvider } = await import('../MobileLayoutAccessProvider');
const { useLayoutMode } = await import('../../shared/hooks/useLayoutMode');
const { useMobileLayoutAccessAnswered } = await import('../../shared/hooks/useMobileLayoutAccess');
const { useLayoutKeyboardShortcut } = await import('../useLayoutKeyboardShortcut');

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function Provider({ children }: { children: ReactNode }) {
  return <MobileLayoutAccessProvider>{children}</MobileLayoutAccessProvider>;
}

describe('0.10.0: мобильный макет открыт всем', () => {
  beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    rpc.mockResolvedValue({ data: false, error: null });
    setViewportWidth(390);
  });

  it.each([['обычный пользователь', 'uid-regular'], ['гость', null]])('%s на 390 px получает mobile без вопроса к базе', (_name, uid) => {
    state.uid = uid;
    const { result } = renderHook(() => ({ mode: useLayoutMode(), answered: useMobileLayoutAccessAnswered() }), { wrapper: Provider });
    expect(result.current.mode.layoutMode).toBe('mobile');
    // Окну первого входа нечего ждать (MC-6): ответ «известен» сразу.
    expect(result.current.answered).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('Ctrl/⌘+M переключает макет у обычного пользователя', () => {
    state.uid = 'uid-regular';
    const { result } = renderHook(() => { useLayoutKeyboardShortcut(); return useLayoutMode(); }, { wrapper: Provider });
    expect(result.current.layoutMode).toBe('mobile');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(result.current.layoutMode).toBe('desktop');
  });
});
