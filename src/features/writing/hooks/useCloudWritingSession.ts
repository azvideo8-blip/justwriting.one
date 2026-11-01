import { useMemo } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { UserProfile } from '../../../types';
import { useBaseWritingSession, BaseSessionReturn } from './useBaseWritingSession';
import { useSessionPersistence } from './useSessionPersistence';
import { useDraftSession } from './useDraftSession';
import type { DraftSaveStatus, DraftErrorKind } from './useDraftCore';
import { useWpm } from './useWpm';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';

export interface CloudSessionReturn extends BaseSessionReturn {
  userId: string;
  isGuest: false;
  hasDraft: boolean;
  /** MQ-3: текст черновика уже в редакторе. */
  draftInEditor: boolean;
  setHasDraft: (v: boolean) => void;
  saveStatus: DraftSaveStatus;
  saveErrorKind: DraftErrorKind;
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

export function useCloudWritingSession(user: AppUser, profile: UserProfile | null): CloudSessionReturn {
  const base = useBaseWritingSession();
  const draft = useDraftSession(user.uid, false);
  // Автосохранению нужны текст и счётчики на каждое нажатие — подписка здесь
  // перерисовывает только этот хук, а не весь экран (объект сессии их не несёт).
  const content = useContentStore(s => s.content);
  const wordCount = useContentStore(s => s.wordCount);
  const seconds = useTimerStore(s => s.seconds);
  const { wpm } = useWpm();

  const persistence = useSessionPersistence(
    user,
    profile,
    {
      title: base.title,
      content,
      pinnedThoughts: base.pinnedThoughts,
      tags: base.tags,
      sessionType: base.sessionType,
      activeSessionId: base.activeSessionId,
      initialDuration: base.initialDuration,
      initialWordCount: base.initialWordCount,
      sessionStartTime: base.sessionStartTime,
    },
    {
      seconds,
      wpm,
      wordCount,
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
      setDraftInEditor: draft.setDraftInEditor,
      resetAndClear: base.resetAndClear,
      resetSession: base.resetSession,
      setStatus: base.setStatus,
      setInitialWordCount: base.setInitialWordCount,
      setInitialDuration: base.setInitialDuration,
    }
  );

  const { hasDraft, draftInEditor, setHasDraft, handleCancel, autoLoadDraftIfEmpty, restoreDraft, discardDraft } = draft;
  const { saveStatus, saveErrorKind, lastSavedAt, isOnline } = persistence;
  return useMemo(() => ({
    ...base,
    userId: user.uid,
    isGuest: false as const,
    hasDraft, draftInEditor, setHasDraft, saveStatus, saveErrorKind, lastSavedAt, isOnline,
    handleCancel, autoLoadDraftIfEmpty, restoreDraft, discardDraft,
  }), [base, user.uid, hasDraft, draftInEditor, setHasDraft, saveStatus, saveErrorKind, lastSavedAt, isOnline,
    handleCancel, autoLoadDraftIfEmpty, restoreDraft, discardDraft]);
}
