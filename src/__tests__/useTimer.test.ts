import { renderHook, act } from '@testing-library/react';
import { useTimer } from '../hooks/useTimer';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('useTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and increments seconds', () => {
    const { result } = renderHook(() => useTimer('stopwatch', 60, null));
    
    act(() => {
      result.current.setStatus('writing');
    });
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(result.current.seconds).toBe(1);
  });

  it('resets timer', () => {
    const { result } = renderHook(() => useTimer('stopwatch', 60, null));
    
    act(() => {
      result.current.setStatus('writing');
      vi.advanceTimersByTime(1000);
      result.current.resetTimer();
    });
    
    expect(result.current.seconds).toBe(0);
    expect(result.current.status).toBe('idle');
  });
});
