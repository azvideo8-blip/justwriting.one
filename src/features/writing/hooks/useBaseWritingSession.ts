import { useCallback, useEffect } from 'react';
import { TimerStatus, SessionType } from '../store/types';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { resetAndClear, finishSession, resetAllSessionMetadata } from '../store/storeActions';
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
  finishSession: () => void;
  resetSessionMetadata: () => void;
  setTimeGoalReached: (reached: boolean) => void;
  setWordGoalReached: (reached: boolean) => void;
}

export function useBaseWritingSession(): BaseSessionReturn {
  const title = useContentStore(s => s.title);
  const content = useContentStore(s => s.content);
  const pinnedThoughts = useContentStore(s => Array.isArray(s.pinnedThoughts) ? s.pinnedThoughts : []);
  const tags = useContentStore(s => Array.isArray(s.tags) ? s.tags : []);
  const labelId = useContentStore(s => s.labelId);
  const wordCount = useContentStore(s => s.wordCount);
  const initialWordCount = useContentStore(s => s.initialWordCount);

  const { wpm } = useWpm();

  const sessionType = useTimerStore(s => s.sessionType);
  const initialDuration = useTimerStore(s => s.initialDuration);
  const seconds = useTimerStore(s => s.seconds);
  const status = useTimerStore(s => s.status);
  const timeGoalReached = useTimerStore(s => s.timeGoalReached);
  const wordGoalReached = useTimerStore(s => s.wordGoalReached);
  const wordGoal = useTimerStore(s => s.wordGoal);
  const timerDuration = useTimerStore(s => s.timerDuration);
  const targetTime = useTimerStore(s => s.targetTime);

  const activeSessionId = useSessionMetaStore(s => s.activeSessionId);
  const sessionStartTime = useSessionMetaStore(s => s.sessionStartTime);

  const setContent = useContentStore(s => s.setContent);
  const setTitle = useContentStore(s => s.setTitle);
  const setPinnedThoughts = useContentStore(s => s.setPinnedThoughts);
  const setTags = useContentStore(s => s.setTags);
  const setLabelId = useContentStore(s => s.setLabelId);
  const setInitialWordCount = useContentStore(s => s.setInitialWordCount);

  const setStatus = useTimerStore(s => s.setStatus);
  const setSessionType = useTimerStore(s => s.setSessionType);
  const setTimerDuration = useTimerStore(s => s.setTimerDuration);
  const setWordGoal = useTimerStore(s => s.setWordGoal);
  const setTargetTime = useTimerStore(s => s.setTargetTime);
  const setInitialDuration = useTimerStore(s => s.setInitialDuration);
  const setTimeGoalReached = useTimerStore(s => s.setTimeGoalReached);
  const setWordGoalReached = useTimerStore(s => s.setWordGoalReached);
  const setSessionStart = useTimerStore(s => s.setSessionStart);

  const setActiveSessionId = useSessionMetaStore(s => s.setActiveSessionId);
  const setSessionStartTime = useSessionMetaStore(s => s.setSessionStartTime);

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
      setSessionStart();
    } else if (currentStatus === 'paused') {
      useTimerStore.getState().resumeSession();
    }
  }, [setStatus, setTimeGoalReached, setWordGoalReached, sessionStartTime, setInitialWordCount, wordCount, setSessionStartTime, setSessionStart]);

  useEffect(() => {
    if (status !== 'writing') return;
    const id = setInterval(() => {
      useTimerStore.getState().checkGoals();
    }, 500);
    return () => clearInterval(id);
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
    resetAndClear, finishSession, resetSessionMetadata: resetAllSessionMetadata,
    setTimeGoalReached, setWordGoalReached,
  };
}
