import { create } from 'zustand';
import { TimerStatus, SessionType } from './types';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { getCurrentUser } from '../../../core/auth';
import { getOrCreateGuestId } from '../../../core/storage/localDb';

/** Цель, с которой стартует режим «Слова», если человек её не менял (Q-11). */
export const DEFAULT_WORD_GOAL = 1000;

export function getSavedWordGoal(uid?: string | null): number {
  if (typeof localStorage === 'undefined') return 1000;
  try {
    const userUid = uid ?? getCurrentUser()?.uid ?? getOrCreateGuestId();
    const key = STORAGE_KEYS.WORD_GOAL(userUid);
    const val = localStorage.getItem(key);
    if (val) {
      const parsed = parseInt(val, 10);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // ignore
  }
  // Q-11 (решение владельца 2026-10-18): цели нет, пока человек её не выбрал.
  // Прежний запас 1000 давал полосу слов у каждой новой сессии, хотя владелец
  // полосы не просил; в режим «Слова» человек входит уже со 1000 (WritingSetup).
  return 0;
}

export function saveWordGoal(goal: number, uid?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const userUid = uid ?? getCurrentUser()?.uid ?? getOrCreateGuestId();
    const key = STORAGE_KEYS.WORD_GOAL(userUid);
    if (goal > 0) {
      localStorage.setItem(key, String(goal));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // намеренно: запись цели слов в localStorage опциональна
  }
}

export interface TimerStateData {
  status: TimerStatus;
  seconds: number;
  sessionStartSeconds: number;
  _startWallMs: number | null;
  _accumulatedMs: number;
  sessionStartEpochMs: number | null;
  sessionStartAccMs: number;
  timerDuration: number;
  /** D-10: задана ли цель по времени явно (GoalPopup / setTimerDuration), а не
   *  унаследована от дефолтных 30 минут. Только явная цель срабатывает в
   *  свободной сессии; AG-TIMER-1 не трогает: finish-by её не учитывает. */
  timeGoalExplicit: boolean;
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
  sessionStartEpochMs: null, sessionStartAccMs: 0,
  timerDuration: 30 * 60, targetTime: null, wordGoal: getSavedWordGoal(),
  timeGoalExplicit: false,
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
    sessionStartEpochMs: Date.now(),
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

    const timerGoalMet = s.sessionType === 'timer' && s.timerDuration > 0 && sessionSeconds >= s.timerDuration;
    // D-10: на десктопе сессия всегда 'free', поэтому явная цель по времени
    // (выбранная в нижней панели) должна давать тот же сигнал, что цель по
    // словам. Дефолтные 30 минут без явного выбора не срабатывают.
    const freeGoalMet = s.sessionType === 'free' && s.timeGoalExplicit
      && s.timerDuration > 0 && sessionSeconds >= s.timerDuration;

    if (newSeconds !== s.seconds ||
      s.timeGoalReached !== (timerGoalMet || freeGoalMet)) {
      if (timerGoalMet || freeGoalMet) {
        timeGoalReached = true;
      }
      // AG-TIMER-1: A session honours only the goal of its own type.
      if (s.sessionType === 'finish-by' && s.targetTime && /^\d{1,2}:\d{2}$/.test(s.targetTime)) {
        const parts = s.targetTime.split(':').map(Number);
        const hours = parts[0] ?? 0;
        const minutes = parts[1] ?? 0;
        const now = new Date();
        const start = s.sessionStartEpochMs ? new Date(s.sessionStartEpochMs) : now;
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
    // D-10: любой вызов из панели/попапа — явный выбор цели; 0 означает «снять».
    const timeGoalExplicit = timerDuration > 0;
    if (state.status !== 'idle' && state.timeGoalReached) {
      const sessionSec = state.getSessionSeconds();
      return {
        timerDuration,
        timeGoalExplicit,
        timeGoalReached: false,
        overtimeSeconds: 0,
        accumulatedDuration: state.accumulatedDuration + sessionSec,
        sessionStartSeconds: state.getElapsedSeconds(),
        sessionStartAccMs: state._accumulatedMs,
        sessionStartEpochMs: Date.now(),
      };
    }
    return { timerDuration, timeGoalExplicit };
  }),

  setWordGoal: (wordGoal, wordCount) => {
    saveWordGoal(wordGoal);
    set((state) => {
      if (state.status !== 'idle' && state.wordGoalReached) {
        return {
          wordGoal,
          wordGoalReached: false,
          // Пропущенный аргумент значит «сохранить базлайн», а не «обнулить»:
          // прежний дефолт делал каждую забывчивую цель мгновенно достигнутой.
          sessionStartWords: wordCount ?? state.sessionStartWords,
        };
      }
      return { wordGoal };
    });
  },

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
    sessionStartEpochMs: Date.now(),
  })),
}));
