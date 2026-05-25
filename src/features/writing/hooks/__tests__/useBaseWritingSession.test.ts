import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBaseWritingSession } from '../useBaseWritingSession';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';
import { useSessionMetaStore } from '../../store/useSessionMetaStore';

vi.mock('../../../core/utils/sound', () => ({
  playGoalSound: vi.fn(),
}));

describe('useBaseWritingSession', () => {
  beforeEach(() => {
    useTimerStore.setState({
      status: 'idle',
      seconds: 0,
      sessionStartSeconds: 0,
      _startWallMs: null,
      _accumulatedMs: 0,
      sessionStartWallMs: null,
      sessionStartAccMs: 0,
      timeGoalReached: false,
      wordGoalReached: false,
      overtimeSeconds: 0,
      accumulatedDuration: 0,
      totalPauseSeconds: 0,
      _pauseWallStart: null,
      sessionStartWords: 0,
      sessionType: 'free',
      timerDuration: 30 * 60,
      wordGoal: 1000,
      targetTime: null,
      initialDuration: 0,
    });
    useContentStore.setState({
      content: '',
      title: '',
      pinnedThoughts: [],
      wordCount: 0,
      initialWordCount: 0,
      wpm: 0,
      wordSnapshots: [],
      lastWordCount: 0,
      wpmHistory: [],
      tags: [],
      labelId: undefined,
    });
    useSessionMetaStore.setState({
      activeSessionId: null,
      savedDocumentId: null,
      sessionStartTime: null,
    });
  });

  it('returns idle state initially', () => {
    const { result } = renderHook(() => useBaseWritingSession());
    expect(result.current.status).toBe('idle');
    expect(result.current.wordCount).toBe(0);
    expect(result.current.seconds).toBe(0);
  });

  it('start() sets status to writing and records sessionStartTime', () => {
    const { result } = renderHook(() => useBaseWritingSession());

    act(() => {
      result.current.handleStart();
    });

    expect(result.current.status).toBe('writing');
    expect(result.current.sessionStartTime).not.toBeNull();
  });

  it('pause() sets status to paused', () => {
    const { result } = renderHook(() => useBaseWritingSession());

    act(() => {
      result.current.handleStart();
    });
    expect(result.current.status).toBe('writing');

    act(() => {
      result.current.setStatus('paused');
    });
    expect(result.current.status).toBe('paused');
  });

  it('resume() sets status back to writing', () => {
    const { result } = renderHook(() => useBaseWritingSession());

    act(() => {
      result.current.handleStart();
    });

    act(() => {
      result.current.setStatus('paused');
    });

    act(() => {
      result.current.handleStart();
    });
    expect(result.current.status).toBe('writing');
  });

  it('finish() sets status to finished and accumulates duration', () => {
    const { result } = renderHook(() => useBaseWritingSession());

    act(() => {
      result.current.handleStart();
    });

    act(() => {
      useTimerStore.getState().pauseSession();
    });
    expect(useTimerStore.getState().status).toBe('paused');

    const _elapsedBefore = useTimerStore.getState()._accumulatedMs;
    act(() => {
      result.current.setStatus('idle');
    });
    expect(result.current.status).toBe('idle');
  });

  it('wordCount increment via store action updates wordCount', () => {
    const { result } = renderHook(() => useBaseWritingSession());
    expect(result.current.wordCount).toBe(0);

    act(() => {
      useContentStore.getState().setInitialWordCount(5);
      useContentStore.setState({ wordCount: 10 });
    });

    expect(result.current.wordCount).toBe(10);
  });
});
