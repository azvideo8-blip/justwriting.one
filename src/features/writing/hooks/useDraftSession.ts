import { useState, useCallback } from 'react';
import { resetAndClear } from '../store/storeActions';
import { useTimerStore } from '../store/useTimerStore';
import { useContentStore } from '../store/useContentStore';
import { applyDraftToStores } from '../utils/draftUtils';
import { WritingDraftService } from '../services/WritingDraftService';
import {
  loadGuestDraftFromStorage,
  deleteGuestDraftFromStorage,
} from '../services/GuestDraftService';

export interface DraftSessionState {
  hasDraft: boolean;
  setHasDraft: (v: boolean) => void;
  handleCancel: () => Promise<void>;
  discardDraft: () => Promise<void>;
  autoLoadDraftIfEmpty: () => Promise<void>;
  restoreDraft: () => Promise<void>;
}

export function useDraftSession(userId: string, isGuest: boolean): DraftSessionState {
  const [hasDraft, setHasDraft] = useState(false);

  const discardDraft = useCallback(async () => {
    if (isGuest) {
      await deleteGuestDraftFromStorage();
    } else {
      await WritingDraftService.deleteDraft(userId);
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

    if (!draft?.content) return;

    const currentContent = useContentStore.getState().content;
    if (currentContent.length > 0) {
      setHasDraft(true);
      return;
    }

    applyDraftToStores(draft);
    setHasDraft(false);
  }, [userId, isGuest]);

  const restoreDraft = useCallback(async () => {
    let draft;
    if (isGuest) {
      draft = await loadGuestDraftFromStorage();
    } else {
      draft = await WritingDraftService.loadDraft(userId);
    }

    if (!draft?.content) {
      setHasDraft(false);
      return;
    }

    applyDraftToStores(draft);
    setHasDraft(false);
  }, [userId, isGuest]);

  return {
    hasDraft,
    setHasDraft,
    handleCancel,
    discardDraft,
    autoLoadDraftIfEmpty,
    restoreDraft,
  };
}
