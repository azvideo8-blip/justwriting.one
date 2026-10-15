import { useCallback, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TimerStatus, SessionType } from '../store/types';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { resetAndClear, resetSession, resetAllSessionMetadata, startWritingSession } from '../store/storeActions';

// EA-9: здесь нет текста, числа слов, секунд и скорости — они меняются на
// каждое нажатие и тик таймера. Объект сессии уходит в контекст экрана письма,
// и любое его изменение перерисовывало весь экран. Листовые компоненты и
// автосохранение подписываются на сторы сами.
export interface BaseSessionReturn {
  status: TimerStatus;
  sessionType: SessionType;
  timerDuration: number;
  wordGoal: number;
  targetTime: string | null;
  title: string;
  pinnedThoughts: string[];
  tags: string[];
  labelId: string | undefined;
  timeGoalReached: boolean;
  wordGoalReached: boolean;
  initialWordCount: number;
  initialDuration: number;
  activeSessionId: string | null;
  sessionStartTime: number | null;
  handleStart: () => void;
  setStatus: (status: TimerStatus) => void;
  setSessionType: (type: SessionType) => void;
  setTimerDuration: (duration: number) => void;
  setWordGoal: (goal: number) => void;
  setTargetTime: (time: string | null) => void;
  setContent: (content: string) => void;
  setTitle: (title: string) => void;
  setPinnedThoughts: (thoughts: string[]) => void;
  setTags: (tags: string[]) => void;
  setLabelId: (labelId?: string) => void;
  setInitialWordCount: (count: number) => void;
  setInitialDuration: (duration: number) => void;
  setActiveSessionId: (id: string | null) => void;
  resetAndClear: () => void;
  resetSession: () => void;
  resetSessionMetadata: () => void;
  setTimeGoalReached: (reached: boolean) => void;
  setWordGoalReached: (reached: boolean) => void;
}

// Один и тот же пустой массив: новый [] на каждый вызов ломал бы мемоизацию.
const EMPTY: string[] = [];

export function useBaseWritingSession(): BaseSessionReturn {
  const {
    title, pinnedThoughts, tags, labelId, initialWordCount,
    setContent, setTitle, setPinnedThoughts, setTags, setLabelId, setInitialWordCount,
  } = useContentStore(useShallow(s => ({
    title: s.title,
    pinnedThoughts: Array.isArray(s.pinnedThoughts) ? s.pinnedThoughts : EMPTY,
    tags: Array.isArray(s.tags) ? s.tags : EMPTY,
    labelId: s.labelId,
    initialWordCount: s.initialWordCount,
    setContent: s.setContent,
    setTitle: s.setTitle,
    setPinnedThoughts: s.setPinnedThoughts,
    setTags: s.setTags,
    setLabelId: s.setLabelId,
    setInitialWordCount: s.setInitialWordCount,
  })));

  const {
    sessionType, initialDuration, status, timeGoalReached, wordGoalReached, wordGoal, timerDuration, targetTime,
    setStatus, setSessionType, setTimerDuration, setWordGoal, setTargetTime, setInitialDuration, setTimeGoalReached, setWordGoalReached,
  } = useTimerStore(useShallow(s => ({
    sessionType: s.sessionType,
    initialDuration: s.initialDuration,
    status: s.status,
    timeGoalReached: s.timeGoalReached,
    wordGoalReached: s.wordGoalReached,
    wordGoal: s.wordGoal,
    timerDuration: s.timerDuration,
    targetTime: s.targetTime,
    setStatus: s.setStatus,
    setSessionType: s.setSessionType,
    setTimerDuration: s.setTimerDuration,
    setWordGoal: s.setWordGoal,
    setTargetTime: s.setTargetTime,
    setInitialDuration: s.setInitialDuration,
    setTimeGoalReached: s.setTimeGoalReached,
    setWordGoalReached: s.setWordGoalReached,
  })));

  const { activeSessionId, sessionStartTime, setActiveSessionId } = useSessionMetaStore(useShallow(s => ({
    activeSessionId: s.activeSessionId,
    sessionStartTime: s.sessionStartTime,
    setActiveSessionId: s.setActiveSessionId,
  })));

  const handleStart = useCallback(() => startWritingSession(), []);

  useEffect(() => {
    if (status !== 'writing') return;
    let isVisible = !document.hidden;
    const onVisibility = () => { isVisible = !document.hidden; };
    document.addEventListener('visibilitychange', onVisibility);
    const id = setInterval(() => {
      if (isVisible) useTimerStore.getState().checkGoals(useContentStore.getState().wordCount);
    }, 500);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      // Pause on unmount (route navigation) to prevent timer drift
      const timerState = useTimerStore.getState();
      if (timerState.status === 'writing') timerState.pauseSession();
    };
  }, [status]);

  return useMemo(() => ({
    status, sessionType, timerDuration, wordGoal, targetTime,
    title, pinnedThoughts,
    tags, labelId,
    timeGoalReached, wordGoalReached, initialWordCount, initialDuration,
    activeSessionId, sessionStartTime,
    handleStart,
    setStatus, setSessionType, setTimerDuration, setWordGoal, setTargetTime,
    setContent, setTitle, setPinnedThoughts,
    setTags, setLabelId,
    setInitialWordCount, setInitialDuration,
    setActiveSessionId,
    resetAndClear, resetSession, resetSessionMetadata: resetAllSessionMetadata,
    setTimeGoalReached, setWordGoalReached,
  }), [
    status, sessionType, timerDuration, wordGoal, targetTime,
    title, pinnedThoughts, tags, labelId,
    timeGoalReached, wordGoalReached, initialWordCount, initialDuration,
    activeSessionId, sessionStartTime, handleStart,
    setStatus, setSessionType, setTimerDuration, setWordGoal, setTargetTime,
    setContent, setTitle, setPinnedThoughts, setTags, setLabelId,
    setInitialWordCount, setInitialDuration, setActiveSessionId,
    setTimeGoalReached, setWordGoalReached,
  ]);
}
