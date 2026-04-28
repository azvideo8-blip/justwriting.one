import { User } from 'firebase/auth';
import { UserProfile } from '../../../types';
import { useBaseWritingSession, BaseSessionReturn } from './useBaseWritingSession';
import { useSessionPersistence } from './useSessionPersistence';
import { useState } from 'react';

import { LocalSessionInfo } from './useGuestWritingSession';

export interface CloudSessionReturn extends BaseSessionReturn {
  userId: string;
  isGuest: false;
  hasDraft: boolean;
  setHasDraft: (v: boolean) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  isOnline: boolean;
  handleCancel: () => Promise<void>;
  fetchLocalSessions: () => Promise<LocalSessionInfo[]>;
  loadLocalSession: (id: string) => Promise<Record<string, unknown> | null>;
  decryptSession: (session: Record<string, unknown>, password: string) => Promise<Record<string, unknown>>;
  loadDraft: () => Promise<void>;
}

export function useCloudWritingSession(user: User, profile: UserProfile | null): CloudSessionReturn {
  const base = useBaseWritingSession();
  const [hasDraft, setHasDraft] = useState(false);

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

  return {
    ...base,
    userId: user.uid,
    isGuest: false as const,
    hasDraft,
    setHasDraft,
    saveStatus: persistence.saveStatus,
    lastSavedAt: persistence.lastSavedAt,
    isOnline: persistence.isOnline,
    handleCancel: persistence.handleCancel,
    fetchLocalSessions: persistence.fetchLocalSessions,
    loadLocalSession: persistence.loadLocalSession,
    decryptSession: persistence.decryptSession,
    loadDraft: persistence.loadDraft,
  };
}
