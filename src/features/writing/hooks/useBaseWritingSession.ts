import { useCallback, useEffect } from 'react';
import { useWritingStore, TimerStatus, SessionType } from '../store/useWritingStore';

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
  isPublic: boolean;
  isAnonymous: boolean;
  tags: string[];
  labelId: string | undefined;
  timeGoalReached: boolean;
  wordGoalReached: boolean;
  initialWordCount: number;
  initialDuration: number;
  activeSessionId: string | null;
  encryptionPassword: string | undefined;
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
  setIsPublic: (v: boolean) => void;
  setIsAnonymous: (v: boolean) => void;
  setTags: (tags: string[]) => void;
  setLabelId: (labelId?: string) => void;
  setInitialWordCount: (count: number) => void;
  setInitialDuration: (duration: number) => void;
  setActiveSessionId: (id: string | null) => void;
  setEncryptionPassword: (password?: string) => void;
  resetSession: () => void;
  finishSession: () => void;
  resetSessionMetadata: () => void;
  setTimeGoalReached: (reached: boolean) => void;
  setWordGoalReached: (reached: boolean) => void;
}

export function useBaseWritingSession(): BaseSessionReturn {
  const title = useWritingStore(s => s.title);
  const content = useWritingStore(s => s.content);
  const pinnedThoughts = useWritingStore(s => s.pinnedThoughts);
  const isPublic = useWritingStore(s => s.isPublic);
  const isAnonymous = useWritingStore(s => s.isAnonymous);
  const tags = useWritingStore(s => s.tags);
  const sessionType = useWritingStore(s => s.sessionType);
  const activeSessionId = useWritingStore(s => s.activeSessionId);
  const encryptionPassword = useWritingStore(s => s.encryptionPassword);
  const initialDuration = useWritingStore(s => s.initialDuration);
  const initialWordCount = useWritingStore(s => s.initialWordCount);
  const sessionStartTime = useWritingStore(s => s.sessionStartTime);
  const seconds = useWritingStore(s => s.seconds);
  const wpm = useWritingStore(s => s.wpm);
  const wordCount = useWritingStore(s => s.wordCount);
  const status = useWritingStore(s => s.status);
  const timeGoalReached = useWritingStore(s => s.timeGoalReached);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const targetTime = useWritingStore(s => s.targetTime);
  const labelId = useWritingStore(s => s.labelId);

  const setContent = useWritingStore(s => s.setContent);
  const setTitle = useWritingStore(s => s.setTitle);
  const setPinnedThoughts = useWritingStore(s => s.setPinnedThoughts);
  const setActiveSessionId = useWritingStore(s => s.setActiveSessionId);
  const setStatus = useWritingStore(s => s.setStatus);
  const setInitialWordCount = useWritingStore(s => s.setInitialWordCount);
  const setInitialDuration = useWritingStore(s => s.setInitialDuration);
  const setTimeGoalReached = useWritingStore(s => s.setTimeGoalReached);
  const setWordGoalReached = useWritingStore(s => s.setWordGoalReached);
  const setSessionStartTime = useWritingStore(s => s.setSessionStartTime);
  const setSessionStart = useWritingStore(s => s.setSessionStart);
  const tick = useWritingStore(s => s.tick);
  const setSessionType = useWritingStore(s => s.setSessionType);
  const setTimerDuration = useWritingStore(s => s.setTimerDuration);
  const setWordGoal = useWritingStore(s => s.setWordGoal);
  const setTargetTime = useWritingStore(s => s.setTargetTime);
  const setIsPublic = useWritingStore(s => s.setIsPublic);
  const setIsAnonymous = useWritingStore(s => s.setIsAnonymous);
  const setTags = useWritingStore(s => s.setTags);
  const setLabelId = useWritingStore(s => s.setLabelId);
  const setEncryptionPassword = useWritingStore(s => s.setEncryptionPassword);
  const resetSession = useWritingStore(s => s.resetSession);
  const resetSessionMetadata = useWritingStore(s => s.resetSessionMetadata);
  const finishSession = useWritingStore(s => s.finishSession);

  const handleStart = useCallback(() => {
    const currentStatus = status;
    setStatus('writing');
    setTimeGoalReached(false);
    setWordGoalReached(false);
    if (!sessionStartTime) {
      setInitialWordCount(wordCount);
      setSessionStartTime(Date.now());
    }
    if (currentStatus === 'idle') {
      setSessionStart();
    }
  }, [status, setStatus, setTimeGoalReached, setWordGoalReached, sessionStartTime, setInitialWordCount, wordCount, setSessionStartTime, setSessionStart]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (status === 'writing') {
      interval = setInterval(() => {
        tick();
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status, tick]);

  return {
    status, sessionType, timerDuration, wordGoal, targetTime,
    content, title, pinnedThoughts, seconds, wpm, wordCount,
    isPublic, isAnonymous, tags, labelId,
    timeGoalReached, wordGoalReached, initialWordCount, initialDuration,
    activeSessionId, encryptionPassword, sessionStartTime,
    handleStart,
    setStatus, setSessionType, setTimerDuration, setWordGoal, setTargetTime,
    setContent, setTitle, setPinnedThoughts,
    setIsPublic, setIsAnonymous, setTags, setLabelId,
    setInitialWordCount, setInitialDuration,
    setActiveSessionId, setEncryptionPassword,
    resetSession, finishSession, resetSessionMetadata,
    setTimeGoalReached, setWordGoalReached,
  };
}
