import { useEffect, useCallback, useMemo } from 'react';
import { User } from 'firebase/auth';
import { useSessionState } from './useSessionState';
import { useSessionTimer } from './useSessionTimer';
import { useSessionPersistence } from './useSessionPersistence';
import { UserProfile } from '../../../types';

export function useWritingSession(user: User, profile: UserProfile | null) {
  const sessionState = useSessionState();
  const {
    sessionType, setSessionType,
    timerDuration, setTimerDuration,
    wordGoal, setWordGoal,
    targetTime, setTargetTime,
    content, setContent,
    title, setTitle,
    pinnedThoughts, setPinnedThoughts,
    isPublic, setIsPublic,
    isAnonymous, setIsAnonymous,
    tags, setTags,
    labelId, setLabelId,
    hasDraft, setHasDraft,
    encryptionPassword, setEncryptionPassword,
    activeSessionId, setActiveSessionId,
    initialWordCount, setInitialWordCount,
    initialDuration, setInitialDuration,
    sessionStartTime, setSessionStartTime,
    resetSessionState,
    resetSessionMetadata
  } = sessionState;

  const timerState = useSessionTimer(
    sessionType,
    timerDuration,
    targetTime,
    content,
    initialWordCount,
    wordGoal
  );

  const {
    seconds, status, setStatus,
    timeGoalReached, setTimeGoalReached,
    resetTimer, wordCount, wpm,
    wordGoalReached, setWordGoalReached,
    resetStats
  } = timerState;

  const resetSession = useCallback(() => {
    resetSessionState();
    resetTimer();
    resetStats();
  }, [resetSessionState, resetTimer, resetStats]);

  const sessionStateData = useMemo(() => ({
    title, content, pinnedThoughts, isPublic, isAnonymous, tags,
    sessionType, activeSessionId, encryptionPassword, initialDuration, initialWordCount, sessionStartTime
  }), [title, content, pinnedThoughts, isPublic, isAnonymous, tags, sessionType, activeSessionId, encryptionPassword, initialDuration, initialWordCount, sessionStartTime]);

  const timerStateData = useMemo(() => ({
    seconds, wpm, wordCount, status, timeGoalReached, wordGoalReached
  }), [seconds, wpm, wordCount, status, timeGoalReached, wordGoalReached]);

  const persistenceActions = useMemo(() => ({
    setContent, setTitle, setPinnedThoughts, setActiveSessionId,
    setHasDraft, resetSession, setStatus, setInitialWordCount, setInitialDuration
  }), [setContent, setTitle, setPinnedThoughts, setActiveSessionId, setHasDraft, resetSession, setStatus, setInitialWordCount, setInitialDuration]);

  const persistence = useSessionPersistence(
    user,
    profile,
    sessionStateData,
    timerStateData,
    persistenceActions
  );

  const {
    saveStatus, lastSavedAt, isOnline,
    handleSave, handleCancel, fetchLocalSessions,
    loadLocalSession, decryptSession, loadDraft
  } = persistence;

  // Load draft on mount
  useEffect(() => {
    if (user) {
      loadDraft();
    }
  }, [user, loadDraft]);

  const handleStart = useCallback(() => {
    setStatus('writing');
    setTimeGoalReached(false);
    setWordGoalReached(false);
    // Только при ПЕРВОМ старте сессии (не при возобновлении после паузы)
    if (!sessionStartTime) {
      setInitialWordCount(wordCount);
      setSessionStartTime(Date.now());
    }
  }, [setStatus, setTimeGoalReached, setWordGoalReached, 
      setInitialWordCount, wordCount, 
      sessionStartTime, setSessionStartTime]);

  return useMemo(() => ({
    status, setStatus,
    sessionType, setSessionType,
    timerDuration, setTimerDuration,
    wordGoal, setWordGoal,
    targetTime, setTargetTime,
    content, setContent,
    title, setTitle,
    pinnedThoughts, setPinnedThoughts,
    seconds,
    wpm, wordCount,
    isPublic, setIsPublic,
    isAnonymous, setIsAnonymous,
    tags, setTags,
    labelId, setLabelId,
    timeGoalReached, wordGoalReached,
    hasDraft, setHasDraft,
    initialWordCount, setInitialWordCount,
    initialDuration, setInitialDuration,
    sessionStartTime, setSessionStartTime,
    activeSessionId, setActiveSessionId,
    saveStatus, lastSavedAt,
    handleStart, handleSave, handleCancel, resetSession,
    resetSessionMetadata,
    isOnline,
    fetchLocalSessions,
    loadLocalSession,
    encryptionPassword, setEncryptionPassword,
    decryptSession
  }), [
    status, setStatus,
    sessionType, setSessionType,
    timerDuration, setTimerDuration,
    wordGoal, setWordGoal,
    targetTime, setTargetTime,
    content, setContent,
    title, setTitle,
    pinnedThoughts, setPinnedThoughts,
    seconds,
    wpm, wordCount,
    isPublic, setIsPublic,
    isAnonymous, setIsAnonymous,
    tags, setTags,
    labelId, setLabelId,
    timeGoalReached, wordGoalReached,
    hasDraft, setHasDraft,
    initialWordCount, setInitialWordCount,
    initialDuration, setInitialDuration,
    sessionStartTime, setSessionStartTime,
    activeSessionId, setActiveSessionId,
    saveStatus, lastSavedAt,
    handleStart, handleSave, handleCancel, resetSession,
    resetSessionMetadata,
    isOnline,
    fetchLocalSessions,
    loadLocalSession,
    encryptionPassword, setEncryptionPassword,
    decryptSession
  ]);
}
