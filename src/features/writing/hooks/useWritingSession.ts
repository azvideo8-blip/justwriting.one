import { useState } from 'react';
import { User } from 'firebase/auth';
import { useBaseWritingSession } from './useBaseWritingSession';
import { useSessionPersistence } from './useSessionPersistence';
import { UserProfile } from '../../../types';

export function useWritingSession(user: User | null, profile: UserProfile | null) {
  const base = useBaseWritingSession();
  const [hasDraft, setHasDraft] = useState(false);

  const persistence = useSessionPersistence(
    user,
    profile,
    {
      title: base.title,
      content: base.content,
      pinnedThoughts: base.pinnedThoughts,
      tags: base.tags,
      sessionType: base.sessionType,
      activeSessionId: base.activeSessionId,
      initialDuration: base.initialDuration,
      initialWordCount: base.initialWordCount,
      sessionStartTime: base.sessionStartTime,
    },
    {
      seconds: base.seconds,
      wpm: base.wpm,
      wordCount: base.wordCount,
      status: base.status,
      timeGoalReached: base.timeGoalReached,
      wordGoalReached: base.wordGoalReached,
    },
    {
      setContent: base.setContent,
      setTitle: base.setTitle,
      setPinnedThoughts: base.setPinnedThoughts,
      setActiveSessionId: base.setActiveSessionId,
      setHasDraft,
      resetSession: base.resetSession,
      finishSession: base.finishSession,
      setStatus: base.setStatus,
      setInitialWordCount: base.setInitialWordCount,
      setInitialDuration: base.setInitialDuration,
    }
  );

  return {
    handleStart: base.handleStart,
    handleSave: persistence.handleSave,
    handleCancel: persistence.handleCancel,
    fetchLocalSessions: persistence.fetchLocalSessions,
    loadLocalSession: persistence.loadLocalSession,
    loadDraft: persistence.loadDraft,
    status: base.status,
    sessionType: base.sessionType,
    timerDuration: base.timerDuration,
    wordGoal: base.wordGoal,
    targetTime: base.targetTime,
    content: base.content,
    title: base.title,
    pinnedThoughts: base.pinnedThoughts,
    seconds: base.seconds,
    wpm: base.wpm,
    wordCount: base.wordCount,
    tags: base.tags,
    labelId: base.labelId,
    timeGoalReached: base.timeGoalReached,
    wordGoalReached: base.wordGoalReached,
    initialWordCount: base.initialWordCount,
    initialDuration: base.initialDuration,
    activeSessionId: base.activeSessionId,
    saveStatus: persistence.saveStatus,
    lastSavedAt: persistence.lastSavedAt,
    isOnline: persistence.isOnline,
    hasDraft,
    setHasDraft,
    setStatus: base.setStatus,
    setSessionType: base.setSessionType,
    setTimerDuration: base.setTimerDuration,
    setWordGoal: base.setWordGoal,
    setTargetTime: base.setTargetTime,
    setContent: base.setContent,
    setTitle: base.setTitle,
    setPinnedThoughts: base.setPinnedThoughts,
    setTags: base.setTags,
    setLabelId: base.setLabelId,
    setInitialWordCount: base.setInitialWordCount,
    setInitialDuration: base.setInitialDuration,
    setActiveSessionId: base.setActiveSessionId,
    resetSession: base.resetSession,
    finishSession: base.finishSession,
    resetSessionMetadata: base.resetSessionMetadata
  };
}

