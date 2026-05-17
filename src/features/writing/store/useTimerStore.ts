import { create } from 'zustand';
import { TimerStatus, SessionType } from './types';
import { useContentStore } from './useContentStore';

interface TimerState {
  status: TimerStatus;
  seconds: number;
  sessionStartWords: number;
  sessionStartSeconds: number;
  timerDuration: number;
  wordGoal: number;
  targetTime: string | null;
  timeGoalReached: boolean;
  wordGoalReached: boolean;
  overtimeSeconds: number;
  accumulatedDuration: number;
  totalPauseSeconds: number;
  _pauseWallStart: number | null;
  sessionType: SessionType;
  initialDuration: number;

  setStatus: (status: TimerStatus) => void;
  setSessionStart: () => void;
  tick: () => void;
  pauseSession: () => void;
  resumeSession: () => void;
  setTimerDuration: (duration: number) => void;
  setWordGoal: (goal: number) => void;
  setTargetTime: (time: string | null) => void;
  setTimeGoalReached: (reached: boolean) => void;
  setWordGoalReached: (reached: boolean) => void;
  setSessionType: (type: SessionType) => void;
  setInitialDuration: (duration: number) => void;
  setAccumulatedDuration: (d: number) => void;
  startFreeSession: () => void;
}

export const useTimerStore = create<TimerState>((set) => ({
  status: 'idle', seconds: 0, sessionType: 'free',
  timerDuration: 30 * 60, targetTime: null, wordGoal: 1000,
  timeGoalReached: false, wordGoalReached: false, overtimeSeconds: 0,
  sessionStartWords: 0, sessionStartSeconds: 0, accumulatedDuration: 0,
  totalPauseSeconds: 0, _pauseWallStart: null,
  initialDuration: 0,

  setStatus: (status) => set({ status }),

  setSessionStart: () => set((state) => ({
    sessionStartWords: useContentStore.getState().wordCount,
    sessionStartSeconds: state.seconds,
  })),

  tick: () => set((state) => {
    if (state.status !== 'writing' && state.status !== 'paused') return state;

    const newSeconds = state.status === 'writing' ? state.seconds + 1 : state.seconds;
    const sessionSeconds = newSeconds - state.sessionStartSeconds;
    let timeGoalReached = state.timeGoalReached;
    let overtimeSeconds = state.overtimeSeconds;

    if (state.sessionType === 'timer' && state.timerDuration > 0 && sessionSeconds >= state.timerDuration) {
      timeGoalReached = true;
    }
    if (state.targetTime) {
      const [hours, minutes] = state.targetTime.split(':').map(Number);
      const now = new Date();
      const target = new Date(now);
      target.setHours(hours, minutes, 0, 0);
      if (now >= target) timeGoalReached = true;
    }

    if (timeGoalReached && state.sessionType === 'timer' && state.timerDuration > 0) {
      overtimeSeconds = sessionSeconds - state.timerDuration;
    }

    return { seconds: newSeconds, timeGoalReached, overtimeSeconds };
  }),

  pauseSession: () => set((state) => state.status === 'writing' ? { status: 'paused' as TimerStatus, _pauseWallStart: Date.now() } : state),

  resumeSession: () => set((state) => {
    if (state.status !== 'paused') return state;
    const extra = state._pauseWallStart != null
      ? Math.round((Date.now() - state._pauseWallStart) / 1000)
      : 0;
    return {
      status: 'writing' as TimerStatus,
      totalPauseSeconds: state.totalPauseSeconds + extra,
      _pauseWallStart: null,
    };
  }),

  setTimerDuration: (timerDuration) => set((state) => {
    if (state.status !== 'idle' && state.timeGoalReached) {
      return {
        timerDuration,
        timeGoalReached: false,
        overtimeSeconds: 0,
        accumulatedDuration: state.accumulatedDuration + (state.seconds - state.sessionStartSeconds),
        sessionStartSeconds: state.seconds,
      };
    }
    return { timerDuration };
  }),

  setWordGoal: (wordGoal) => set((state) => {
    if (state.status !== 'idle' && state.wordGoalReached) {
      return {
        wordGoal,
        wordGoalReached: false,
        sessionStartWords: useContentStore.getState().wordCount,
      };
    }
    return { wordGoal };
  }),

  setTargetTime: (targetTime) => set({ targetTime }),
  setTimeGoalReached: (timeGoalReached) => set({ timeGoalReached }),
  setWordGoalReached: (wordGoalReached) => set({ wordGoalReached }),
  setSessionType: (sessionType) => set({ sessionType }),
  setInitialDuration: (initialDuration) => set({ initialDuration }),
  setAccumulatedDuration: (accumulatedDuration) => set({ accumulatedDuration }),

  startFreeSession: () => set((state) => ({
    sessionType: 'free' as SessionType,
    sessionStartWords: useContentStore.getState().wordCount,
    sessionStartSeconds: state.seconds,
  })),
}));
