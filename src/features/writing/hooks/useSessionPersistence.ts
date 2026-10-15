import { useEffect, useCallback, useRef } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { WritingDraftService } from '../services/WritingDraftService';
import { LocalDraft } from '../../../core/storage/localDb';
import { useContentStore } from '../store/useContentStore';
import { VAULT_UNLOCKED_EVENT } from '../../../core/crypto/useEncryptionStore';

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
  setDraftInEditor: (inEditor: boolean) => void;
  resetAndClear: () => void;
  resetSession: () => void;
  setStatus: (status: TimerStatus) => void;
  setInitialWordCount: (count: number) => void;
  setInitialDuration: (duration: number) => void;
}

export function useSessionPersistence(
  user: AppUser | null,
  profile: UserProfile | null,
  sessionState: SessionStateSlice,
  timerState: TimerStateSlice,
  actions: PersistenceActions
) {
  const isOnline = useOnlineStatus();
  const userId = user?.uid ?? '';
  const { saveStatus, saveErrorKind, lastSavedAt } = useDraftAutosave(user, {
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

  const { setActiveSessionId, setHasDraft, setDraftInEditor } = actions;

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
      const current = useContentStore.getState().content;
      if (!current) applyDraftToStore(draftToLoad);
      // MQ-3: текст черновика уже в редакторе (подставлен сейчас или стоял там и раньше) —
      // «Восстановить» ему нечего делать. hasDraft при этом остаётся true: десктоп не меняется.
      setDraftInEditor(!current || current === draftToLoad.content);
      await WritingDraftService.clearLegacyDraft(userId);
    }
    // If cloud draft is currently locked, do not prevent reloading once vault is unlocked.
    if (!WritingDraftService.isCloudDraftLocked()) {
      draftLoadedForRef.current = userId;
    }
  }, [userId, setHasDraft, setDraftInEditor, applyDraftToStore]);

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

  // S-4: When the vault is unlocked, reload the now-decryptable cloud draft.
  useEffect(() => {
    const onVaultUnlocked = () => {
      draftLoadedForRef.current = null;
      void autoLoadDraftIfEmpty();
    };
    window.addEventListener(VAULT_UNLOCKED_EVENT, onVaultUnlocked);
    return () => window.removeEventListener(VAULT_UNLOCKED_EVENT, onVaultUnlocked);
  }, [autoLoadDraftIfEmpty]);

  const handleCancel = useCallback(async () => {
    WritingDraftService.bumpDraftGeneration(userId);
    await WritingDraftService.deleteDraft(userId); // намеренно: сброс черновика при отмене сессии
    actions.setHasDraft(false);
    actions.resetAndClear();
    actions.setStatus('idle');
  }, [userId, actions]);

  return {
    saveStatus,
    saveErrorKind,
    lastSavedAt,
    isOnline,
    handleCancel,
    autoLoadDraftIfEmpty,
    restoreDraft
  };
}
