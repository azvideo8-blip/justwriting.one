import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSessionTimer } from '../hooks/useSessionTimer';

describe('useSessionTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should correctly calculate WPM based on elapsed time and word count', async () => {
    const { result, rerender } = renderHook(
      ({ content }) => useSessionTimer('stopwatch', 0, null, content, 0, 0),
      {
        initialProps: { content: '' }
      }
    );

    act(() => {
      result.current.setStatus('writing');
    });

    // Advance time by 60 seconds
    act(() => {
      vi.advanceTimersByTime(60000);
    });

    // Trigger rerender with new content to update stats
    rerender({ content: 'one two three four five' });

    expect(result.current.seconds).toBe(60);
    expect(result.current.wordCount).toBe(5);
    // WPM = (words - initial) / seconds * 60 = (5 - 0) / 60 * 60 = 5
    expect(result.current.wpm).toBe(5);
  });

  it('should pause the timer and retain elapsed seconds when status changes to paused', () => {
    const { result } = renderHook(() => useSessionTimer('stopwatch', 0, null, '', 0, 0));

    act(() => {
      result.current.setStatus('writing');
    });

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(result.current.seconds).toBe(30);

    act(() => {
      result.current.setStatus('paused');
    });

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(result.current.seconds).toBe(30);
    expect(result.current.status).toBe('paused');
  });

  it('should trigger wordGoalReached when the specific word count is hit', () => {
    const { result, rerender } = renderHook(
      ({ content }) => useSessionTimer('words', 0, null, content, 0, 10),
      {
        initialProps: { content: 'one two three' }
      }
    );

    expect(result.current.wordGoalReached).toBe(false);

    rerender({ content: 'one two three four five six seven eight nine ten' });

    expect(result.current.wordCount).toBe(10);
    expect(result.current.wordGoalReached).toBe(true);
  });
  
  it('should trigger timeGoalReached when timerDuration is hit', () => {
    const { result } = renderHook(() => useSessionTimer('timer', 60, null, '', 0, 0));

    act(() => {
      result.current.setStatus('writing');
    });

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(result.current.seconds).toBe(60);
    expect(result.current.timeGoalReached).toBe(true);
  });
});
