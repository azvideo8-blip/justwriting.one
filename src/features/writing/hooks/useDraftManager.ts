import { useEffect, useCallback, useRef, useMemo } from 'react';
import type { RefObject } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { useTimerStore } from '../store/useTimerStore';
import { useContentStore } from '../store/useContentStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { useDraftCore, useVisibilitySave, useSyncUnloadSave, type DraftSaveStatus, type DraftErrorKind } from './useDraftCore';

export interface DraftData {
  content: string;
  title: string;
  pinnedThoughts: string[];
  seconds: number;
  wpm: number;
  wordCount: number;
  initialWordCount?: number;
  sessionStartTime?: number | null | undefined;
  activeSessionId?: string | null | undefined;
  savedDocumentId?: string | null | undefined;
  tags?: string[] | undefined;
  labelId?: string | undefined;
  accumulatedDuration?: number | undefined;
  totalPauseSeconds?: number | undefined;
}

export interface DraftManagerOptions {
  onSaveDraft: (data: DraftData) => Promise<void>;
}

export function useDraftManager(
  userId: string | null,
  getDraftData: () => DraftData,
  options: DraftManagerOptions
) {
  const { saveStatus, saveErrorKind, lastSavedAt, wrapSave } = useDraftCore({ userId });
  const getDraftDataRef = useRef(getDraftData);
  const onSaveDraftRef = useRef(options.onSaveDraft);
  const timerStatus = useTimerStore(s => s.status);

  // D-2: keep a ref with the latest draft data for useSyncUnloadSave so guests
  // get a beforeunload/pagehide localStorage fallback.
  const liveDraftRef = useMemo(() => ({ get current() { return getDraftDataRef.current(); } }), []);
  useEffect(() => {
    getDraftDataRef.current = getDraftData;
    onSaveDraftRef.current = options.onSaveDraft;
  }, [getDraftData, options.onSaveDraft]);

  const doAutosave = useCallback(async () => {
    const data = getDraftDataRef.current();
    const meta = useSessionMetaStore.getState();
    if (
      meta.savedDocumentId &&
      meta.loadedContent !== null &&
      data.content === meta.loadedContent &&
      (meta.loadedTitle ?? '') === (data.title ?? '')
    ) {
      return;
    }
    await wrapSave(
      async () => {
        await onSaveDraftRef.current(data);
      },
      'draftManager/autosave'
    );
  }, [wrapSave]);

  const content = useContentStore(s => s.content);
  const title = useContentStore(s => s.title);

  // Depend on the boolean, not the text: with `content` in the deps the 30s
  // interval restarts on every keystroke and never fires while someone types
  // continuously — the case it exists for.
  const hasContent = Boolean(content.trim() || title.trim());

  useEffect(() => {
    const isTimerActive = timerStatus === 'writing' || timerStatus === 'paused';
    // D-24: нетронутую продолженную заметку отсекает сам doAutosave — здесь
    // проверять её нельзя: для этого пришлось бы зависеть от текста.
    if (!isTimerActive && !hasContent) return;

    // S-8: 3s initial timer persists session row on timer start if content is empty; 30s interval saves periodically.
    const timeout = isTimerActive && !hasContent ? setTimeout(() => void doAutosave(), 3_000) : undefined;
    const interval = setInterval(() => void doAutosave(), 30_000);
    return () => {
      if (timeout) clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [doAutosave, timerStatus, hasContent]);

  // Mirror of the authenticated debounce in useDraftAutosave: without it a guest is
  // only saved by the 30s interval above, so a crash mid-sentence can cost half a
  // minute of writing. A flat delay is enough here because this path writes to
  // IndexedDB only — the authenticated path uses 5s on mobile to protect the
  // Cloud write quotas, which do not apply to guests.
  useEffect(() => {
    // S-8: Save within 1s of content changing, regardless of timer status.
    const meta = useSessionMetaStore.getState();
    const isPristine = Boolean(
      meta.savedDocumentId &&
      meta.loadedContent !== null &&
      content === meta.loadedContent &&
      (meta.loadedTitle ?? '') === title
    );
    if (!hasContent || isPristine) return;
    const timeout = setTimeout(() => void doAutosave(), 1_000);
    return () => clearTimeout(timeout);
  }, [content, title, hasContent, doAutosave]);

  useVisibilitySave(doAutosave, () => getDraftData().content);

  // D-2: guests (and cloud users via this manager) get a beforeunload/pagehide
  // localStorage fallback so closing the tab between 30s autosaves doesn't lose
  // recent typing.
  useSyncUnloadSave(
    userId ? ({ uid: userId } as AppUser) : null,
    liveDraftRef as unknown as RefObject<{ pinnedThoughts: string[]; sessionStartTime?: number | undefined; activeSessionId: string | null; [key: string]: unknown }>,
  );

  const forceSave = useCallback(async () => {
    await doAutosave();
  }, [doAutosave]);

  return {
    saveStatus: saveStatus as DraftSaveStatus,
    saveErrorKind: saveErrorKind as DraftErrorKind,
    lastSavedAt,
    forceSave,
  };
}
