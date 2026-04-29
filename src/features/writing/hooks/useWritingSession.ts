import { useCallback, useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { useSessionPersistence } from './useSessionPersistence';
import { UserProfile } from '../../../types';

export function useWritingSession(user: User | null, profile: UserProfile | null) {
  const title = useWritingStore(s => s.title);
  const content = useWritingStore(s => s.content);
  const pinnedThoughts = useWritingStore(s => s.pinnedThoughts);
  const tags = useWritingStore(s => s.tags);
  const sessionType = useWritingStore(s => s.sessionType);
  const activeSessionId = useWritingStore(s => s.activeSessionId);
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
  const setTags = useWritingStore(s => s.setTags);
  const setLabelId = useWritingStore(s => s.setLabelId);
  const resetSession = useWritingStore(s => s.resetSession);
  const resetSessionMetadata = useWritingStore(s => s.resetSessionMetadata);
  const finishSession = useWritingStore(s => s.finishSession);

  const [hasDraft, setHasDraft] = useState(false);

  const persistence = useSessionPersistence(
    user,
    profile,
    {
      title,
      content,
      pinnedThoughts,
      tags,
      sessionType,
      activeSessionId,
      initialDuration,
      initialWordCount,
      sessionStartTime,
    },
    {
      seconds,
      wpm,
      wordCount,
      status,
      timeGoalReached,
      wordGoalReached,
    },
    {
      setContent,
      setTitle,
      setPinnedThoughts,
      setActiveSessionId,
      setHasDraft,
      resetSession,
      finishSession,
      setStatus,
      setInitialWordCount,
      setInitialDuration,
    }
  );

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
    handleStart,
    handleSave: persistence.handleSave,
    handleCancel: persistence.handleCancel,
    fetchLocalSessions: persistence.fetchLocalSessions,
    loadLocalSession: persistence.loadLocalSession,
    loadDraft: persistence.loadDraft,
    // State values
    status,
    sessionType,
    timerDuration,
    wordGoal,
    targetTime,
    content,
    title,
    pinnedThoughts,
    seconds,
    wpm,
    wordCount,
    tags,
    labelId,
    timeGoalReached,
    wordGoalReached,
    initialWordCount,
    initialDuration,
    activeSessionId,
    saveStatus: persistence.saveStatus,
    lastSavedAt: persistence.lastSavedAt,
    isOnline: persistence.isOnline,
    hasDraft,
    // Setters
    setHasDraft,
    setStatus,
    setSessionType,
    setTimerDuration,
    setWordGoal,
    setTargetTime,
    setContent,
    setTitle,
    setPinnedThoughts,
    setTags,
    setLabelId,
    setInitialWordCount,
    setInitialDuration,
    setActiveSessionId,
    resetSession,
    finishSession,
    resetSessionMetadata
  };
}

