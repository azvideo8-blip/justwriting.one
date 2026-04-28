import { User } from 'firebase/auth';
import { UserProfile } from '../../../types';
import { useBaseWritingSession, BaseSessionReturn } from './useBaseWritingSession';
import { useSessionPersistence } from './useSessionPersistence';
import { useState, useCallback } from 'react';
import { useWritingStore } from '../store/useWritingStore';
import { UnifiedSessionService } from '../services/UnifiedSessionService';
import { WritingDraftService } from '../services/WritingDraftService';
import { useSessionSource } from './useSessionSource';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';

import { LocalSessionInfo } from './useGuestWritingSession';

export interface CloudSessionReturn extends BaseSessionReturn {
  userId: string;
  isGuest: false;
  hasDraft: boolean;
  setHasDraft: (v: boolean) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  isOnline: boolean;
  handleSave: (isLocalOnly: boolean) => Promise<void>;
  handleCancel: () => Promise<void>;
  fetchLocalSessions: () => Promise<LocalSessionInfo[]>;
  loadLocalSession: (id: string) => Promise<Record<string, unknown> | null>;
  decryptSession: (session: Record<string, unknown>, password: string) => Promise<Record<string, unknown>>;
  loadDraft: () => Promise<void>;
  onSaveComplete: (() => void) | null;
}

export function useCloudWritingSession(user: User, profile: UserProfile | null): CloudSessionReturn {
  const base = useBaseWritingSession();
  const [hasDraft, setHasDraft] = useState(false);
  const [onSaveComplete, setOnSaveComplete] = useState<(() => void) | null>(null);

  const persistence = useSessionPersistence(
    user,
    profile,
    {
      title: base.title,
      content: base.content,
      pinnedThoughts: base.pinnedThoughts,
      isPublic: base.isPublic,
      isAnonymous: base.isAnonymous,
      tags: base.tags,
      sessionType: base.sessionType,
      activeSessionId: base.activeSessionId,
      encryptionPassword: base.encryptionPassword || '',
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

  const source = useSessionSource();
  const isBrowserOnline = useOnlineStatus();
  const effectiveSource = !isBrowserOnline && source !== 'local' ? 'local' : source;

  const handleSave = useCallback(async (_isLocalOnly: boolean) => {
    const state = useWritingStore.getState();
    const sessionSeconds = state.accumulatedDuration + (state.seconds - state.sessionStartSeconds);

    await UnifiedSessionService.saveAsNewDocument(user.uid, {
      title: state.title || '',
      content: state.content,
      wordCount: state.wordCount,
      duration: sessionSeconds,
      wpm: state.wpm,
      isPublic: base.isPublic,
      tags: base.tags,
      labelId: state.labelId,
      goalWords: state.wordGoal > 0 ? state.wordGoal : undefined,
      goalTime: state.timerDuration > 0 ? state.timerDuration : undefined,
      goalReached: state.wordGoal > 0 && state.wordCount >= state.wordGoal,
      sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
    }, effectiveSource);

    await WritingDraftService.deleteDraft(user.uid);
    base.finishSession();
  }, [user.uid, base, effectiveSource]);

  return {
    ...base,
    userId: user.uid,
    isGuest: false as const,
    hasDraft,
    setHasDraft,
    saveStatus: persistence.saveStatus,
    lastSavedAt: persistence.lastSavedAt,
    isOnline: persistence.isOnline,
    handleSave,
    handleCancel: persistence.handleCancel,
    fetchLocalSessions: persistence.fetchLocalSessions,
    loadLocalSession: persistence.loadLocalSession,
    decryptSession: persistence.decryptSession,
    loadDraft: persistence.loadDraft,
    onSaveComplete,
  };
}
