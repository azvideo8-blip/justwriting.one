import { useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TimerStatus, SessionType } from '../store/types';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { resetAndClear, resetSession, resetAllSessionMetadata } from '../store/storeActions';
import { useWpm } from './useWpm';

export interface BaseSessionReturn {
  status: TimerStatus;
  sessionType: SessionType;
  timerDuration: number;
  wordGoal: number;
  targetTime: string | null;
  content: string;
  title: string;
  pinnedThoughts: string[];
  seconds: number;
  wpm: number;
  wordCount: number;
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

export function useBaseWritingSession(): BaseSessionReturn {
  const {
    title, content, pinnedThoughts, tags, labelId, wordCount, initialWordCount,
    setContent, setTitle, setPinnedThoughts, setTags, setLabelId, setInitialWordCount,
  } = useContentStore(useShallow(s => ({
    title: s.title,
    content: s.content,
    pinnedThoughts: Array.isArray(s.pinnedThoughts) ? s.pinnedThoughts : [],
    tags: Array.isArray(s.tags) ? s.tags : [],
    labelId: s.labelId,
    wordCount: s.wordCount,
    initialWordCount: s.initialWordCount,
    setContent: s.setContent,
    setTitle: s.setTitle,
    setPinnedThoughts: s.setPinnedThoughts,
    setTags: s.setTags,
    setLabelId: s.setLabelId,
    setInitialWordCount: s.setInitialWordCount,
  })));

  const { wpm } = useWpm();

  const {
    sessionType, initialDuration, seconds, status, timeGoalReached, wordGoalReached, wordGoal, timerDuration, targetTime,
    setStatus, setSessionType, setTimerDuration, setWordGoal, setTargetTime, setInitialDuration, setTimeGoalReached, setWordGoalReached, setSessionStart,
  } = useTimerStore(useShallow(s => ({
    sessionType: s.sessionType,
    initialDuration: s.initialDuration,
    seconds: s.seconds,
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
    setSessionStart: s.setSessionStart,
  })));

  const { activeSessionId, sessionStartTime, setActiveSessionId, setSessionStartTime } = useSessionMetaStore(useShallow(s => ({
    activeSessionId: s.activeSessionId,
    sessionStartTime: s.sessionStartTime,
    setActiveSessionId: s.setActiveSessionId,
    setSessionStartTime: s.setSessionStartTime,
  })));

  const handleStart = useCallback(() => {
    const currentStatus = useTimerStore.getState().status;
    setStatus('writing');
    setTimeGoalReached(false);
    setWordGoalReached(false);
    if (!sessionStartTime) {
      setInitialWordCount(wordCount);
      setSessionStartTime(Date.now());
    }
    if (currentStatus === 'idle') {
      useTimerStore.setState({ _startWallMs: performance.now(), _accumulatedMs: 0, seconds: 0, sessionStartSeconds: 0 });
      setSessionStart(wordCount);
    } else if (currentStatus === 'paused') {
      useTimerStore.getState().resumeSession();
    }
  }, [setStatus, setTimeGoalReached, setWordGoalReached, sessionStartTime, setInitialWordCount, wordCount, setSessionStartTime, setSessionStart]);

  useEffect(() => {
    if (status !== 'writing') return;
    let isVisible = !document.hidden;
    const onVisibility = () => { isVisible = !document.hidden; };
    document.addEventListener('visibilitychange', onVisibility);
    const id = setInterval(() => {
      if (isVisible) useTimerStore.getState().checkGoals();
    }, 500);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status]);

  return {
    status, sessionType, timerDuration, wordGoal, targetTime,
    content, title, pinnedThoughts, seconds, wpm, wordCount,
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
  };
}
