import { renderHook, act } from '@testing-library/react';
import { useWritingStats } from '../hooks/useWritingStats';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('useWritingStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates word count correctly', () => {
    const { result } = renderHook(() =>
      useWritingStats('one two three four', 0, 0, 'stopwatch', 500)
    );
    expect(result.current.wordCount).toBe(4);
  });

  it('counts short words correctly', () => {
    const { result } = renderHook(() =>
      useWritingStats('I am in flow', 0, 0, 'stopwatch', 500)
    );
    expect(result.current.wordCount).toBe(4);
  });

  it('subtracts initialWordCount from total to get session words', () => {
    // User continues a session that already had 10 words
    const { result } = renderHook(() =>
      useWritingStats('one two three four five six seven eight nine ten eleven', 0, 10, 'stopwatch', 500)
    );
    // 11 total words - 10 initial = 1 session word
    expect(result.current.wordCount).toBe(1);
  });

  it('calculates WPM using sliding window buffer after enough time has passed', () => {
    const { result, rerender } = renderHook(
      ({ content }) => useWritingStats(content, 0, 0, 'stopwatch', 500),
      { initialProps: { content: '' } }
    );

    // Advance 5 seconds — first sample is taken
    act(() => { vi.advanceTimersByTime(5000); });
    rerender({ content: 'one two three four five' });

    // Advance another 5 seconds — second sample is taken, WPM can be calculated
    act(() => { vi.advanceTimersByTime(5000); });
    rerender({ content: 'one two three four five six seven eight nine ten' });

    // 5 new words over 5 seconds = 60 WPM
    expect(result.current.wpm).toBe(60);
  });

  it('decays WPM to 0 after 30 seconds of inactivity', () => {
    const { result, rerender } = renderHook(
      ({ content }) => useWritingStats(content, 0, 0, 'stopwatch', 500),
      { initialProps: { content: '' } }
    );

    // Build up WPM first
    act(() => { vi.advanceTimersByTime(5000); });
    rerender({ content: 'one two three four five' });
    act(() => { vi.advanceTimersByTime(5000); });
    rerender({ content: 'one two three four five six seven eight nine ten' });

    // Now stop writing and wait > 30 seconds for decay to kick in
    act(() => { vi.advanceTimersByTime(60000); });

    expect(result.current.wpm).toBe(0);
  });

  it('triggers wordGoalReached when session words reach the goal', () => {
    // initialWordCount = 5, goal = 3, so goal is reached after writing 3 new words
    const { result, rerender } = renderHook(
      ({ content }) => useWritingStats(content, 0, 5, 'words', 3),
      { initialProps: { content: 'a b c d e' } } // 5 words, sessionWords = 0
    );

    expect(result.current.wordGoalReached).toBe(false);

    rerender({ content: 'a b c d e f g h' }); // 8 words, sessionWords = 3
    expect(result.current.wordGoalReached).toBe(true);
  });

  it('resets stats correctly', () => {
    const { result } = renderHook(() =>
      useWritingStats('one two three four', 0, 0, 'stopwatch', 500)
    );
    act(() => { result.current.resetStats(); });
    expect(result.current.wordCount).toBe(0);
    expect(result.current.wpm).toBe(0);
    expect(result.current.wordGoalReached).toBe(false);
  });
});
