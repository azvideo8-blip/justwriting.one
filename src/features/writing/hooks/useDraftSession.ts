import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import { resetAndClear } from '../store/storeActions';
import { useTimerStore } from '../store/useTimerStore';
import { useContentStore } from '../store/useContentStore';
import { applyDraftToStores } from '../utils/draftUtils';
import { WritingDraftService } from '../services/WritingDraftService';
import { markEditorTextOwner } from '../services/draftWriter';
import {
  loadGuestDraftFromStorage,
  deleteGuestDraftFromStorage,
} from '../services/GuestDraftService';

export interface DraftSessionState {
  hasDraft: boolean;
  setHasDraft: (v: boolean) => void;
  /** MQ-3: текст черновика уже стоит в редакторе — «Восстановить» ему нечего делать. */
  draftInEditor: boolean;
  setDraftInEditor: (v: boolean) => void;
  handleCancel: () => Promise<void>;
  discardDraft: () => Promise<void>;
  autoLoadDraftIfEmpty: () => Promise<void>;
  restoreDraft: () => Promise<void>;
}

export function useDraftSession(userId: string, isGuest: boolean): DraftSessionState {
  const [hasDraft, setHasDraft] = useState(false);
  const [draftInEditor, setDraftInEditor] = useState(false);

  // DW-F-3: ответ загрузки может прийти после смены аккаунта в этой вкладке —
  // подставлять его нельзя, текст прежнего человека окажется под новым.
  const userIdRef = useRef(userId);
  useLayoutEffect(() => { userIdRef.current = userId; }, [userId]);

  const discardDraft = useCallback(async () => {
    if (isGuest) {
      await deleteGuestDraftFromStorage();
    } else {
      WritingDraftService.bumpDraftGeneration(userId);
      await WritingDraftService.deleteDraft(userId); // намеренно: сброс черновика при отмене или сбросе сессии
    }
    setHasDraft(false);
  }, [userId, isGuest]);

  const handleCancel = useCallback(async () => {
    await discardDraft();
    resetAndClear();
    useTimerStore.getState().setStatus('idle');
  }, [discardDraft]);

  const autoLoadDraftIfEmpty = useCallback(async () => {
    let draft;
    if (isGuest) {
      draft = await loadGuestDraftFromStorage();
    } else {
      draft = await WritingDraftService.loadDraft(userId);
    }

    if (userIdRef.current !== userId) return;
    if (!draft?.content) return;
    const currentContent = useContentStore.getState().content;
    if (currentContent.length > 0) {
      setHasDraft(true);
      return;
    }

    applyDraftToStores(draft, isGuest ? null : userId);
    // DW4-4: загруженный черновик назначает зеркало — его владелец, а для
    // гостя сам гость (у гостевого текста владельца-аккаунта нет, DW-6).
    markEditorTextOwner(isGuest ? userId : draft.owner ?? userId);
    setHasDraft(false);
  }, [userId, isGuest]);

  const restoreDraft = useCallback(async () => {
    let draft;
    if (isGuest) {
      draft = await loadGuestDraftFromStorage();
    } else {
      draft = await WritingDraftService.loadDraft(userId);
    }

    if (userIdRef.current !== userId) return;
    if (!draft?.content) {
      setHasDraft(false);
      return;
    }

    applyDraftToStores(draft, isGuest ? null : userId);
    markEditorTextOwner(isGuest ? userId : draft.owner ?? userId);
    setHasDraft(false);
  }, [userId, isGuest]);

  return {
    hasDraft,
    setHasDraft,
    draftInEditor,
    setDraftInEditor,
    handleCancel,
    discardDraft,
    autoLoadDraftIfEmpty,
    restoreDraft,
  };
}
