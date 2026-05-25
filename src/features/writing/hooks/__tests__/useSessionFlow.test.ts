import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionFlow } from '../useSessionFlow';
import { useTimerStore } from '../../store/useTimerStore';
import { SessionType } from '../../store/types';

vi.mock('../../../core/utils/sound', () => ({
  playGoalSound: vi.fn(),
}));

vi.mock('../../../shared/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ layoutMode: 'desktop', setLayoutMode: vi.fn() }),
}));

describe('useSessionFlow', () => {
  const mockHandleStart = vi.fn();
  const mockSetSessionType = vi.fn();

  const defaultProps = {
    handleStart: mockHandleStart,
    sessionStatus: 'idle' as string,
    sessionType: 'free' as SessionType,
    setSessionType: mockSetSessionType,
    targetTime: null as string | null,
    seconds: 0,
    timeGoalReached: false,
    wordGoalReached: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions from idle to writing on start', async () => {
    const props = { ...defaultProps, sessionStatus: 'idle' };
    const { result } = renderHook(
      (p) => useSessionFlow(p.handleStart, p.sessionStatus, p.sessionType, p.setSessionType, p.targetTime, p.seconds, p.timeGoalReached, p.wordGoalReached),
      { initialProps: props },
    );

    act(() => {
      result.current.startCountdown('free');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    expect(mockHandleStart).toHaveBeenCalled();
  });

  it('transitions from writing to paused', async () => {
    const { result, rerender } = renderHook(
      (p) => useSessionFlow(p.handleStart, p.sessionStatus, p.sessionType, p.setSessionType, p.targetTime, p.seconds, p.timeGoalReached, p.wordGoalReached),
      { initialProps: { ...defaultProps, sessionStatus: 'writing' } },
    );

    expect(result.current.sessionStartFlash).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    rerender({ ...defaultProps, sessionStatus: 'paused' });
    expect(result.current.sessionStartFlash).toBe(false);
  });

  it('transitions from paused to writing on resume', async () => {
    const { result, rerender } = renderHook(
      (p) => useSessionFlow(p.handleStart, p.sessionStatus, p.sessionType, p.setSessionType, p.targetTime, p.seconds, p.timeGoalReached, p.wordGoalReached),
      { initialProps: { ...defaultProps, sessionStatus: 'paused' } },
    );

    rerender({ ...defaultProps, sessionStatus: 'writing' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.sessionStartFlash).toBe(true);
  });

  it('transitions from writing to finished (idle) on finish', async () => {
    const { result, rerender } = renderHook(
      (p) => useSessionFlow(p.handleStart, p.sessionStatus, p.sessionType, p.setSessionType, p.targetTime, p.seconds, p.timeGoalReached, p.wordGoalReached),
      { initialProps: { ...defaultProps, sessionStatus: 'writing' } },
    );

    expect(result.current.sessionStartFlash).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    rerender({ ...defaultProps, sessionStatus: 'idle' });
    expect(result.current.sessionStartFlash).toBe(false);
  });

  it('cannot start if already writing', () => {
    const { result } = renderHook(
      (p) => useSessionFlow(p.handleStart, p.sessionStatus, p.sessionType, p.setSessionType, p.targetTime, p.seconds, p.timeGoalReached, p.wordGoalReached),
      { initialProps: { ...defaultProps, sessionStatus: 'writing' } },
    );

    act(() => {
      result.current.startCountdown('free');
    });

    expect(mockSetSessionType).toHaveBeenCalledWith('free');
  });
});
