import { create } from 'zustand';
import { TimerStatus, SessionType } from './types';

export interface TimerStateData {
  status: TimerStatus;
  seconds: number;
  sessionStartSeconds: number;
  _startWallMs: number | null;
  _accumulatedMs: number;
  sessionStartWallMs: number | null;
  sessionStartAccMs: number;
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
  sessionStartWords: number;
}

interface TimerState extends TimerStateData {
  getElapsedSeconds: () => number;
  getSessionSeconds: () => number;
  setStatus: (status: TimerStatus) => void;
  setSessionStart: (wordCount: number) => void;
  pauseSession: () => void;
  resumeSession: () => void;
  checkGoals: (wordCount?: number) => void;
  setTimerDuration: (duration: number) => void;
  setWordGoal: (goal: number, wordCount?: number) => void;
  setTargetTime: (targetTime: string | null) => void;
  setTimeGoalReached: (reached: boolean) => void;
  setWordGoalReached: (reached: boolean) => void;
  setSessionType: (type: SessionType) => void;
  setInitialDuration: (seconds: number) => void;
  setAccumulatedDuration: (seconds: number) => void;
  startFreeSession: (wordCount: number) => void;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  status: 'idle', sessionType: 'free',
  seconds: 0, sessionStartSeconds: 0,
  _startWallMs: null, _accumulatedMs: 0,
  sessionStartWallMs: null, sessionStartAccMs: 0,
  timerDuration: 30 * 60, targetTime: null, wordGoal: 1000,
  timeGoalReached: false, wordGoalReached: false, overtimeSeconds: 0,
  accumulatedDuration: 0,
  totalPauseSeconds: 0, _pauseWallStart: null,
  initialDuration: 0, sessionStartWords: 0,

  getElapsedSeconds: () => {
    const s = get();
    if (s.status !== 'writing' || s._startWallMs == null) return Math.floor(s._accumulatedMs / 1000);
    return Math.floor((s._accumulatedMs + (performance.now() - s._startWallMs)) / 1000);
  },

  getSessionSeconds: () => {
    const s = get();
    const elapsed = s.getElapsedSeconds();
    return elapsed - s.sessionStartSeconds;
  },

  setStatus: (status) => set({ status }),

  setSessionStart: (wordCount) => set((state) => ({
    sessionStartWords: wordCount,
    sessionStartSeconds: state.getElapsedSeconds(),
    sessionStartAccMs: state._accumulatedMs,
    sessionStartWallMs: state._startWallMs,
  })),

  pauseSession: () => set((state) => {
    if (state.status !== 'writing') return state;
    const now = performance.now();
    const newAccMs = state._startWallMs != null
      ? state._accumulatedMs + (now - state._startWallMs)
      : state._accumulatedMs;
    return {
      status: 'paused' as TimerStatus,
      _accumulatedMs: newAccMs,
      _startWallMs: null,
      seconds: Math.floor(newAccMs / 1000),
      _pauseWallStart: Date.now(),
    };
  }),

  resumeSession: () => set((state) => {
    if (state.status !== 'paused') return state;
    const extra = state._pauseWallStart != null
      ? Math.round((Date.now() - state._pauseWallStart) / 1000)
      : 0;
    return {
      status: 'writing' as TimerStatus,
      _startWallMs: performance.now(),
      totalPauseSeconds: state.totalPauseSeconds + extra,
      _pauseWallStart: null,
    };
  }),

  checkGoals: (wordCount?: number) => {
    const s = get();
    const newSeconds = s.getElapsedSeconds();
    const sessionSeconds = newSeconds - s.sessionStartSeconds;

    let timeGoalReached = s.timeGoalReached;
    let wordGoalReached = s.wordGoalReached;
    let overtimeSeconds = s.overtimeSeconds;

    if (newSeconds !== s.seconds ||
      s.timeGoalReached !== (s.sessionType === 'timer' && s.timerDuration > 0 && sessionSeconds >= s.timerDuration)) {
      if (s.sessionType === 'timer' && s.timerDuration > 0 && sessionSeconds >= s.timerDuration) {
        timeGoalReached = true;
      }
      if (s.targetTime && /^\d{1,2}:\d{2}$/.test(s.targetTime)) {
        const parts = s.targetTime.split(':').map(Number);
        const hours = parts[0] ?? 0;
        const minutes = parts[1] ?? 0;
        const now = new Date();
        const start = s.sessionStartWallMs ? new Date(s.sessionStartWallMs) : now;
        const target = new Date(start);
        target.setHours(hours, minutes, 0, 0);
        if (target <= start) {
          target.setDate(target.getDate() + 1);
        }
        if (now >= target) timeGoalReached = true;
      }

      overtimeSeconds = 0;
      if (timeGoalReached && s.sessionType === 'timer' && s.timerDuration > 0) {
        overtimeSeconds = Math.max(0, sessionSeconds - s.timerDuration);
      }
    }

    if (wordCount !== undefined && s.wordGoal > 0) {
      const sessionWords = wordCount - s.sessionStartWords;
      wordGoalReached = sessionWords >= s.wordGoal;
    }

    set({ seconds: newSeconds, timeGoalReached, wordGoalReached, overtimeSeconds });
  },

  setTimerDuration: (timerDuration) => set((state) => {
    if (state.status !== 'idle' && state.timeGoalReached) {
      const sessionSec = state.getSessionSeconds();
      return {
        timerDuration,
        timeGoalReached: false,
        overtimeSeconds: 0,
        accumulatedDuration: state.accumulatedDuration + sessionSec,
        sessionStartSeconds: state.getElapsedSeconds(),
        sessionStartAccMs: state._accumulatedMs,
        sessionStartWallMs: state._startWallMs,
      };
    }
    return { timerDuration };
  }),

  setWordGoal: (wordGoal, wordCount) => set((state) => {
    if (state.status !== 'idle' && state.wordGoalReached) {
      return {
        wordGoal,
        wordGoalReached: false,
        sessionStartWords: wordCount ?? 0,
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

  startFreeSession: (wordCount) => set((state) => ({
    sessionType: 'free' as SessionType,
    sessionStartWords: wordCount,
    sessionStartSeconds: state.getElapsedSeconds(),
    sessionStartAccMs: state._accumulatedMs,
    sessionStartWallMs: state._startWallMs,
  })),
}));
