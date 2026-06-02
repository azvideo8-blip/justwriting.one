import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStartOfToday } from '../useStartOfToday';

describe('useStartOfToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns start of today on mount', () => {
    const now = new Date(2024, 6, 15, 14, 30, 0); // July 15, 2024 14:30
    vi.setSystemTime(now);

    const { result } = renderHook(() => useStartOfToday());
    const expected = new Date(2024, 6, 15, 0, 0, 0);
    expect(result.current).toEqual(expected);
  });

  it('updates at midnight', () => {
    const now = new Date(2024, 6, 15, 23, 59, 59); // 1 second before midnight
    vi.setSystemTime(now);

    const { result } = renderHook(() => useStartOfToday());
    expect(result.current).toEqual(new Date(2024, 6, 15, 0, 0, 0));

    // Fast-forward past midnight
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current).toEqual(new Date(2024, 6, 16, 0, 0, 0));
  });

  it('cleans up timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const now = new Date(2024, 6, 15, 10, 0, 0);
    vi.setSystemTime(now);

    const { unmount } = renderHook(() => useStartOfToday());
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
