import { renderHook, act } from '@testing-library/react';
import { useWritingStats } from '../hooks/useWritingStats';
import { describe, it, expect } from 'vitest';

describe('useWritingStats', () => {
  it('calculates word count correctly', () => {
    const { result } = renderHook(() => useWritingStats('one two three four', 0, 0, 'stopwatch', 500));
    expect(result.current.wordCount).toBe(4);
  });

  it('calculates WPM correctly', () => {
    const { result } = renderHook(() => useWritingStats('one two three four', 60, 0, 'stopwatch', 500));
    // (4 words / 60 seconds) * 60 = 4 WPM
    expect(result.current.wpm).toBe(4);
  });

  it('resets stats correctly', () => {
    const { result } = renderHook(() => useWritingStats('one two three four', 60, 0, 'stopwatch', 500));
    act(() => {
      result.current.resetStats();
    });
    expect(result.current.wordCount).toBe(0);
    expect(result.current.wpm).toBe(0);
  });
});
