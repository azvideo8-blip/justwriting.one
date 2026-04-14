import { useCallback, useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { useSessionPersistence } from './useSessionPersistence';
import { UserProfile } from '../../../types';

export function useWritingSession(user: User, profile: UserProfile | null) {
  const store = useWritingStore();
  const [hasDraft, setHasDraft] = useState(false);

  const persistence = useSessionPersistence(
    user,
    profile,
    {
      title: store.title,
      content: store.content,
      pinnedThoughts: store.pinnedThoughts,
      isPublic: store.isPublic,
      isAnonymous: store.isAnonymous,
      tags: store.tags,
      sessionType: store.sessionType,
      activeSessionId: store.activeSessionId,
      encryptionPassword: store.encryptionPassword || '',
      initialDuration: store.initialDuration,
      initialWordCount: store.initialWordCount,
      sessionStartTime: store.sessionStartTime,
    },
    {
      seconds: store.seconds,
      wpm: store.wpm,
      wordCount: store.wordCount,
      status: store.status,
      timeGoalReached: store.timeGoalReached,
      wordGoalReached: store.wordGoalReached,
    },
    {
      setContent: store.setContent,
      setTitle: store.setTitle,
      setPinnedThoughts: store.setPinnedThoughts,
      setActiveSessionId: store.setActiveSessionId,
      setHasDraft,
      resetSession: store.resetSession,
      setStatus: store.setStatus,
      setInitialWordCount: store.setInitialWordCount,
      setInitialDuration: store.setInitialDuration,
    }
  );

  const handleStart = useCallback(() => {
    store.setStatus('writing');
    store.setTimeGoalReached(false);
    store.setWordGoalReached(false);
    if (!store.sessionStartTime) {
      store.setInitialWordCount(store.wordCount);
      store.setSessionStartTime(Date.now());
    }
    store.setSessionStart();
  }, [store]);

  const status = store.status;
  const tick = store.tick;

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
    decryptSession: persistence.decryptSession,
    loadDraft: persistence.loadDraft,
    // State values
    status: store.status,
    sessionType: store.sessionType,
    timerDuration: store.timerDuration,
    wordGoal: store.wordGoal,
    targetTime: store.targetTime,
    content: store.content,
    title: store.title,
    pinnedThoughts: store.pinnedThoughts,
    seconds: store.seconds,
    wpm: store.wpm,
    wordCount: store.wordCount,
    isPublic: store.isPublic,
    isAnonymous: store.isAnonymous,
    tags: store.tags,
    labelId: store.labelId,
    timeGoalReached: store.timeGoalReached,
    wordGoalReached: store.wordGoalReached,
    initialWordCount: store.initialWordCount,
    initialDuration: store.initialDuration,
    activeSessionId: store.activeSessionId,
    encryptionPassword: store.encryptionPassword,
    saveStatus: persistence.saveStatus,
    lastSavedAt: persistence.lastSavedAt,
    isOnline: persistence.isOnline,
    hasDraft,
    // Setters
    setHasDraft,
    setStatus: store.setStatus,
    setSessionType: store.setSessionType,
    setTimerDuration: store.setTimerDuration,
    setWordGoal: store.setWordGoal,
    setTargetTime: store.setTargetTime,
    setContent: store.setContent,
    setTitle: store.setTitle,
    setPinnedThoughts: store.setPinnedThoughts,
    setIsPublic: store.setIsPublic,
    setIsAnonymous: store.setIsAnonymous,
    setTags: store.setTags,
    setLabelId: store.setLabelId,
    setInitialWordCount: store.setInitialWordCount,
    setInitialDuration: store.setInitialDuration,
    setActiveSessionId: store.setActiveSessionId,
    setEncryptionPassword: store.setEncryptionPassword,
    resetSession: store.resetSession,
    resetSessionMetadata: store.resetSessionMetadata
  };
}

