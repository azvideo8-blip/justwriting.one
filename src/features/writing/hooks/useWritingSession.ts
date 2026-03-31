import React, { useEffect, useCallback } from 'react';
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

  const sessionStateData = React.useMemo(() => ({
    title, content, pinnedThoughts, isPublic, isAnonymous, tags,
    sessionType, activeSessionId, encryptionPassword, initialDuration, initialWordCount
  }), [title, content, pinnedThoughts, isPublic, isAnonymous, tags, sessionType, activeSessionId, encryptionPassword, initialDuration, initialWordCount]);

  const timerStateData = React.useMemo(() => ({
    seconds, wpm, wordCount, status, timeGoalReached, wordGoalReached
  }), [seconds, wpm, wordCount, status, timeGoalReached, wordGoalReached]);

  const persistenceActions = React.useMemo(() => ({
    setContent, setTitle, setPinnedThoughts, setActiveSessionId,
    setHasDraft, resetSession, setStatus
  }), [setContent, setTitle, setPinnedThoughts, setActiveSessionId, setHasDraft, resetSession, setStatus]);

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
    if (initialWordCount === 0) {
      setInitialWordCount(wordCount);
    }
  }, [setStatus, setTimeGoalReached, setWordGoalReached, setInitialWordCount, wordCount, initialWordCount]);

  return React.useMemo(() => ({
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
