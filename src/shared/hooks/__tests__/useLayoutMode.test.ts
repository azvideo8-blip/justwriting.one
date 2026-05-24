import { describe, it, expect, beforeEach, vi } from 'vitest';
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
});
