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
      sessionStartEpochMs: null,
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

  // EA-9: объект сессии уходит в контекст экрана письма. Если он меняется на
  // каждое нажатие и тик таймера, перерисовывается весь экран.
  it('keeps the same session object while text, word count and timer change', () => {
    const { result } = renderHook(() => useBaseWritingSession());
    const before = result.current;
    act(() => {
      useContentStore.setState({ content: 'новый текст', wordCount: 2, wpm: 40 });
      useTimerStore.setState({ seconds: 17 });
    });
    expect(result.current).toBe(before);

    act(() => { useContentStore.setState({ title: 'Заголовок' }); });
    expect(result.current).not.toBe(before);
  });
});
