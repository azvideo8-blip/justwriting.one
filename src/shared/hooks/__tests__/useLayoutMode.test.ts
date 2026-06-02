import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLayoutMode } from '../useLayoutMode';

describe('useLayoutMode', () => {
  let mediaQueryListeners: ((e: any) => void)[] = [];
  const matchMediaMock = vi.fn().mockImplementation((query) => {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn((fn) => mediaQueryListeners.push(fn)),
      removeListener: vi.fn(),
      addEventListener: vi.fn((event, fn) => {
        mediaQueryListeners.push(fn);
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });

  beforeEach(() => {
    mediaQueryListeners = [];
    vi.stubGlobal('matchMedia', matchMediaMock);
    localStorage.clear();
  });

  it('should initialize with mobile if width is small', () => {
    matchMediaMock.mockImplementationOnce((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('mobile');
  });

  it('should initialize with desktop if width is large', () => {
    matchMediaMock.mockImplementationOnce((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('desktop');
  });

  it('should update layoutMode when media query changes', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('desktop');

    // Simulate window resizing / media query change
    await act(async () => {
      mediaQueryListeners.forEach((listener) => listener({ matches: true } as any));
      // Wait for debounce timeout
      vi.advanceTimersByTime(150);
    });

    expect(result.current.layoutMode).toBe('mobile');
    vi.useRealTimers();
  });

  it('should provide setLayoutMode function', () => {
    matchMediaMock.mockImplementationOnce((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useLayoutMode());
    expect(typeof result.current.setLayoutMode).toBe('function');
  });

  it('should set layoutMode manually', () => {
    matchMediaMock.mockImplementationOnce((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setLayoutMode('mobile');
    });
    expect(result.current.layoutMode).toBe('mobile');
  });

  it('should persist layoutMode to localStorage', () => {
    matchMediaMock.mockImplementationOnce((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useLayoutMode());
    act(() => {
      result.current.setLayoutMode('mobile');
    });
    expect(localStorage.getItem('layout-mode')).toBe('"mobile"');
  });

  it('should read layoutMode from localStorage on init', () => {
    localStorage.setItem('layout-mode', '"mobile"');

    matchMediaMock.mockImplementationOnce((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('mobile');
  });

  it('should use legacy addListener when addEventListener is unavailable', async () => {
    vi.useFakeTimers();
    const legacyListeners: ((e: { matches: boolean }) => void)[] = [];

    const legacyMatchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: undefined,
      removeEventListener: vi.fn(),
      addListener: vi.fn((fn: (e: { matches: boolean }) => void) => {
        legacyListeners.push(fn);
      }),
      removeListener: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', legacyMatchMedia);

    const { result } = renderHook(() => useLayoutMode());
    expect(result.current.layoutMode).toBe('desktop');

    await act(async () => {
      legacyListeners.forEach((listener) => listener({ matches: true }));
      vi.advanceTimersByTime(150);
    });

    expect(result.current.layoutMode).toBe('mobile');
    vi.useRealTimers();
  });

  it('should clear timeout and remove listener on unmount', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const removeEventListenerMock = vi.fn();

    const cleanupMatchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: removeEventListenerMock,
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', cleanupMatchMedia);

    const { unmount } = renderHook(() => useLayoutMode());
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(removeEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));
    clearTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });
});
