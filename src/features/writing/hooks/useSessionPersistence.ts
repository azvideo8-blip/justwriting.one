import { useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { WritingDraftService } from '../services/WritingDraftService';
import { LocalDraft } from '../../../core/storage/localDb';
import { useContentStore } from '../store/useContentStore';

import { applyDraftToStores } from '../utils/draftUtils';
import { useDraftAutosave } from './useDraftAutosave';
import { UserProfile } from '../../../types';

import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { TimerStatus, SessionType } from '../store/types';


export interface SessionStateSlice {
  title: string;
  content: string;
  pinnedThoughts: string[];
  tags: string[];
  sessionType: SessionType;
  activeSessionId: string | null;
  initialDuration: number;
  initialWordCount: number;
  sessionStartTime: number | null;
}

export interface TimerStateSlice {
  seconds: number;
  wpm: number;
  wordCount: number;
  status: TimerStatus;
  timeGoalReached: boolean;
  wordGoalReached: boolean;
}

export interface PersistenceActions {
  setContent: (content: string) => void;
  setTitle: (title: string) => void;
  setPinnedThoughts: (thoughts: string[]) => void;
  setActiveSessionId: (id: string | null) => void;
  setHasDraft: (has: boolean) => void;
  resetAndClear: () => void;
  resetSession: () => void;
  setStatus: (status: TimerStatus) => void;
  setInitialWordCount: (count: number) => void;
  setInitialDuration: (duration: number) => void;
}

export function useSessionPersistence(
  user: User | null,
  profile: UserProfile | null,
  sessionState: SessionStateSlice,
  timerState: TimerStateSlice,
  actions: PersistenceActions
) {
  const isOnline = useOnlineStatus();
  const userId = user?.uid ?? '';
  const { saveStatus, lastSavedAt } = useDraftAutosave(user, {
    title: sessionState.title,
    content: sessionState.content,
    pinnedThoughts: sessionState.pinnedThoughts,
    seconds: timerState.seconds,
    wpm: timerState.wpm,
    wordCount: timerState.wordCount,
    initialWordCount: sessionState.initialWordCount,
    sessionStartTime: sessionState.sessionStartTime ?? undefined,
    activeSessionId: sessionState.activeSessionId,
    status: timerState.status
  });

  const sessionStateRef = useRef(sessionState);
  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  const { setActiveSessionId, setHasDraft } = actions;

  const applyDraftToStore = useCallback((draft: LocalDraft) => {
    applyDraftToStores(draft);
    if (draft.activeSessionId) setActiveSessionId(draft.activeSessionId);
  }, [setActiveSessionId]);

  const draftLoadedForRef = useRef<string | null>(null);
  /**
   * Automatically loads the draft if the current store content is empty.
   * If there is a draft but the store already has content, it sets hasDraft to true.
   */
  const autoLoadDraftIfEmpty = useCallback(async () => {
    if (draftLoadedForRef.current === userId) return;
    if (!userId) return;
    
    const draftToLoad = await WritingDraftService.loadDraft(userId);
    if (draftToLoad) {
      setHasDraft(true);
      if (!useContentStore.getState().content) {
        applyDraftToStore(draftToLoad);
      }
      await WritingDraftService.clearLegacyDraft(userId);
    }
    draftLoadedForRef.current = userId;
  }, [userId, setHasDraft, applyDraftToStore]);

  /**
   * Forcefully restores the draft, overwriting any current content in the store.
   */
  const restoreDraft = useCallback(async () => {
    if (!userId) return;
    const draftToLoad = await WritingDraftService.loadDraft(userId);
    if (!draftToLoad) { setHasDraft(false); return; }
    applyDraftToStore(draftToLoad);
    setHasDraft(false);
    await WritingDraftService.clearLegacyDraft(userId);
  }, [userId, setHasDraft, applyDraftToStore]);

  useEffect(() => {
    void autoLoadDraftIfEmpty();
  }, [autoLoadDraftIfEmpty]);

  const handleCancel = useCallback(async () => {
    await WritingDraftService.deleteDraft(userId);
    actions.setHasDraft(false);
    actions.resetAndClear();
    actions.setStatus('idle');
  }, [userId, actions]);

  return {
    saveStatus,
    lastSavedAt,
    isOnline,
    handleCancel,
    autoLoadDraftIfEmpty,
    restoreDraft
  };
}
