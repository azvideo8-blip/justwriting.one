import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCountUp } from '../useCountUp';

describe('useCountUp', () => {
  it('returns a number', () => {
    const { result } = renderHook(() => useCountUp(100, 800));
    expect(typeof result.current).toBe('number');
  });

  it('cancels animation on unmount', () => {
    const cancelMock = vi.fn();
    const origRAF = globalThis.requestAnimationFrame;
    const origCAF = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = () => 123;
    globalThis.cancelAnimationFrame = cancelMock;

    const { unmount } = renderHook(() => useCountUp(10, 100));
    unmount();
    expect(cancelMock).toHaveBeenCalledWith(123);

    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
  });

  it('updates when target changes', () => {
    const origRAF = globalThis.requestAnimationFrame;
    const origCAF = globalThis.cancelAnimationFrame;
    let rafId = 0;
    const rafCallbacks: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return ++rafId;
    };
    globalThis.cancelAnimationFrame = vi.fn();

    const { result, rerender } = renderHook(({ target }) => useCountUp(target, 100), {
      initialProps: { target: 50 },
    });
    expect(result.current).toBe(0);

    // The effect should have queued a RAF
    expect(rafCallbacks.length).toBeGreaterThan(0);

    rerender({ target: 75 });
    // The old effect should have been cancelled
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();

    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
  });
});
