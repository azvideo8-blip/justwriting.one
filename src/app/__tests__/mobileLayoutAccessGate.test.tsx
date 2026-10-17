import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// MB-1: мобильный макет — только админу и служебному аккаунту. Право отдаёт база
// (миграция 0041, RPC `mobile_layout_allowed`); клиент спрашивает один раз на
// вошедшего пользователя и держит ответ только в памяти.
const { state, rpc } = vi.hoisted(() => ({
  state: { uid: 'uid-admin' as string | null },
  rpc: vi.fn(),
}));

vi.mock('../../features/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ user: state.uid === null ? null : { uid: state.uid } }),
}));
vi.mock('../../core/supabase/client', () => ({
  getSupabase: () => ({ rpc }),
}));
vi.mock('../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
// 0.10.0: макет открыт всем; здесь проверяется аварийный режим «по праву из базы».
vi.mock('../../shared/hooks/mobileLayoutFlag', () => ({ MOBILE_LAYOUT_ENABLED: false }));

const { MobileLayoutAccessProvider } = await import('../MobileLayoutAccessProvider');
const { useLayoutMode } = await import('../../shared/hooks/useLayoutMode');
const { useMobileLayoutAccess } = await import('../../shared/hooks/useMobileLayoutAccess');
const { useLayoutKeyboardShortcut } = await import('../useLayoutKeyboardShortcut');

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

function Provider({ children }: { children: ReactNode }) {
  return <MobileLayoutAccessProvider>{children}</MobileLayoutAccessProvider>;
}

function pressCmdM(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyM', metaKey: true, bubbles: true, cancelable: true,
    }));
  });
}

describe('MB-1: право на мобильный макет', () => {
  beforeEach(() => {
    localStorage.clear();
    rpc.mockReset();
    state.uid = 'uid-admin';
    setViewportWidth(1024);
  });

  it('разрешённый аккаунт на 390 px получает mobile', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    setViewportWidth(390);
    const { result } = renderHook(() => useLayoutMode(), { wrapper: Provider });

    await waitFor(() => expect(result.current.layoutMode).toBe('mobile'));
    expect(rpc).toHaveBeenCalledWith('mobile_layout_allowed');
  });

  it('обычный пользователь на 390 px остаётся на desktop', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    setViewportWidth(390);
    const { result } = renderHook(() => useLayoutMode(), { wrapper: Provider });

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(result.current.layoutMode).toBe('desktop');
  });

  it('отказ RPC → desktop, а не «разрешено по умолчанию»', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: '42501 insufficient privilege' } });
    setViewportWidth(390);
    const { result } = renderHook(() => useLayoutMode(), { wrapper: Provider });

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(result.current.layoutMode).toBe('desktop');
  });

  it('гость не спрашивает право и остаётся на desktop', async () => {
    state.uid = null;
    setViewportWidth(390);
    const { result } = renderHook(() => useLayoutMode(), { wrapper: Provider });

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(0));
    expect(result.current.layoutMode).toBe('desktop');
  });

  it('смена аккаунта с разрешённого на неразрешённый → desktop без перезагрузки', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    setViewportWidth(390);
    const { result, rerender } = renderHook(() => useLayoutMode(), { wrapper: Provider });
    await waitFor(() => expect(result.current.layoutMode).toBe('mobile'));

    state.uid = 'uid-plain';
    rpc.mockResolvedValue({ data: false, error: null });
    rerender();

    await waitFor(() => expect(result.current.layoutMode).toBe('desktop'));
    expect(rpc).toHaveBeenCalledTimes(2);
    // Смена аккаунта не требует перезагрузки: прежний ответ привязан к uid и на
    // новом аккаунте не читается, пока не пришёл свежий.
    expect(rpc).toHaveBeenLastCalledWith('mobile_layout_allowed');
  });

  it('явный выбор desktop из localStorage сильнее автоопределения (ловушка тикета)', async () => {
    localStorage.setItem('layout-mode-v4', '"desktop"');
    rpc.mockResolvedValue({ data: true, error: null });
    setViewportWidth(390);
    const { result } = renderHook(() => useLayoutMode(), { wrapper: Provider });

    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(result.current.layoutMode).toBe('desktop');
  });

  it('Ctrl/⌘+M переключает макет у разрешённого аккаунта', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    setViewportWidth(1024);
    const { result } = renderHook(
      () => ({ access: useMobileLayoutAccess(), mode: useLayoutMode().layoutMode, shortcut: useLayoutKeyboardShortcut() }),
      { wrapper: Provider },
    );
    // Слушатель навешивается после того, как право прочитано: ждать именно
    // ответа, а не вызова rpc, — иначе та же проверка краснеет от порядка тиков.
    await waitFor(() => expect(result.current.access).toBe(true));
    expect(result.current.mode).toBe('desktop');
    expect(localStorage.getItem('layout-mode-v4')).toBeNull();

    pressCmdM();
    expect(localStorage.getItem('layout-mode-v4')).toBe('"mobile"');
  });

  it('Ctrl/⌘+M молчит у неразрешённого аккаунта', async () => {
    state.uid = 'uid-plain';
    rpc.mockResolvedValue({ data: false, error: null });
    setViewportWidth(1024);
    const { result } = renderHook(
      () => ({ access: useMobileLayoutAccess(), mode: useLayoutMode().layoutMode, shortcut: useLayoutKeyboardShortcut() }),
      { wrapper: Provider },
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(result.current.access).toBe(false);

    pressCmdM();
    expect(localStorage.getItem('layout-mode-v4')).toBeNull();
  });
});
