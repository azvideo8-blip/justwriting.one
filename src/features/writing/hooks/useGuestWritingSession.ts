import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWpm } from './useWpm';
import { useBaseWritingSession } from './useBaseWritingSession';
import { getOrCreateGuestId } from '../../../core/storage/localDb';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import {
  saveGuestDraftToStorage,
} from '../services/GuestDraftService';
import { useDraftManager, DraftData } from './useDraftManager';
import type { DraftSaveStatus } from './useDraftCore';
import { useDraftSession } from './useDraftSession';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';

export interface GuestSessionReturn extends ReturnType<typeof useBaseWritingSession> {
  userId: string;
  isGuest: true;
  hasDraft: boolean;
  setHasDraft: (v: boolean) => void;
  saveStatus: DraftSaveStatus;
  saveErrorKind: 'quota' | 'unknown' | null;
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

export function useGuestWritingSession(): GuestSessionReturn {
  const base = useBaseWritingSession();
  // См. useCloudWritingSession: горячие значения — только для черновика.
  const content = useContentStore(s => s.content);
  const wordCount = useContentStore(s => s.wordCount);
  const seconds = useTimerStore(s => s.seconds);
  const { wpm } = useWpm();
  const guestId = getOrCreateGuestId();
  const draft = useDraftSession(guestId, true);
  const isOnline = useOnlineStatus();

  const draftDataRef = useRef<DraftData>({
    content: '', title: '', pinnedThoughts: [], seconds: 0, wpm: 0, wordCount: 0,
  });

  useEffect(() => {
    draftDataRef.current = {
      content,
      title: base.title,
      pinnedThoughts: base.pinnedThoughts,
      seconds,
      wpm,
      wordCount,
      initialWordCount: useContentStore.getState().initialWordCount,
      sessionStartTime: useSessionMetaStore.getState().sessionStartTime ?? undefined,
      activeSessionId: useSessionMetaStore.getState().activeSessionId ?? undefined,
      savedDocumentId: useSessionMetaStore.getState().savedDocumentId ?? undefined,
      tags: base.tags,
      labelId: base.labelId,
      accumulatedDuration: useTimerStore.getState().accumulatedDuration,
      totalPauseSeconds: useTimerStore.getState().totalPauseSeconds,
    };
  }, [content, base.title, base.pinnedThoughts, seconds, wpm, wordCount, base.tags, base.labelId]);

  const getDraftData = useCallback(() => draftDataRef.current, []);

  const onSaveDraft = useCallback(async (data: DraftData) => {
    await saveGuestDraftToStorage({
      content: data.content,
      title: data.title,
      pinnedThoughts: data.pinnedThoughts,
      seconds: data.seconds,
      wordCount: data.wordCount,
      initialWordCount: data.initialWordCount,
      sessionStartTime: data.sessionStartTime,
      activeSessionId: data.activeSessionId,
      savedDocumentId: data.savedDocumentId,
      tags: data.tags,
      labelId: data.labelId,
      accumulatedDuration: data.accumulatedDuration,
      totalPauseSeconds: data.totalPauseSeconds,
      timestamp: Date.now(),
    });
  }, []);

  const draftManager = useDraftManager(guestId, getDraftData, { onSaveDraft });

  const { autoLoadDraftIfEmpty } = draft;
  useEffect(() => {
    void autoLoadDraftIfEmpty();
  }, [autoLoadDraftIfEmpty]);

  const { hasDraft, setHasDraft, handleCancel, restoreDraft, discardDraft } = draft;
  const { saveStatus, saveErrorKind, lastSavedAt } = draftManager;
  return useMemo(() => ({
    ...base,
    userId: guestId,
    isGuest: true as const,
    hasDraft, setHasDraft, saveStatus, saveErrorKind, lastSavedAt, isOnline,
    handleCancel, autoLoadDraftIfEmpty, restoreDraft, discardDraft,
  }), [base, guestId, hasDraft, setHasDraft, saveStatus, saveErrorKind, lastSavedAt, isOnline,
    handleCancel, autoLoadDraftIfEmpty, restoreDraft, discardDraft]);
}
