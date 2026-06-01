import { User } from 'firebase/auth';
import { UserProfile } from '../../../types';
import { useBaseWritingSession, BaseSessionReturn } from './useBaseWritingSession';
import { useSessionPersistence } from './useSessionPersistence';
import { useDraftSession } from './useDraftSession';

export interface CloudSessionReturn extends BaseSessionReturn {
  userId: string;
  isGuest: false;
  hasDraft: boolean;
  setHasDraft: (v: boolean) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  isOnline: boolean;
  handleCancel: () => Promise<void>;
  /**
   * Automatically loads the draft if the current store content is empty.
   * If there is a draft but the store already has content, it sets hasDraft to true.
   */
  autoLoadDraftIfEmpty: () => Promise<void>;
  /**
   * Forcefully restores the draft, overwriting any current content in the store.
   */
  restoreDraft: () => Promise<void>;
  discardDraft: () => Promise<void>;
}

export function useCloudWritingSession(user: User, profile: UserProfile | null): CloudSessionReturn {
  const base = useBaseWritingSession();
  const draft = useDraftSession(user.uid, false);

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
      setHasDraft: draft.setHasDraft,
      resetAndClear: base.resetAndClear,
      resetSession: base.resetSession,
      setStatus: base.setStatus,
      setInitialWordCount: base.setInitialWordCount,
      setInitialDuration: base.setInitialDuration,
    }
  );

  return {
    ...base,
    userId: user.uid,
    isGuest: false as const,
    hasDraft: draft.hasDraft,
    setHasDraft: draft.setHasDraft,
    saveStatus: persistence.saveStatus,
    lastSavedAt: persistence.lastSavedAt,
    isOnline: persistence.isOnline,
    handleCancel: draft.handleCancel,
    autoLoadDraftIfEmpty: draft.autoLoadDraftIfEmpty,
    restoreDraft: draft.restoreDraft,
    discardDraft: draft.discardDraft,
  };
}
