import { useEffect, useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type { User } from 'firebase/auth';
import { useTimerStore } from '../store/useTimerStore';
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
  const draftSnapshotRef = useRef(getDraftData());
  useEffect(() => {
    getDraftDataRef.current = getDraftData;
    onSaveDraftRef.current = options.onSaveDraft;
    draftSnapshotRef.current = getDraftData();
  }, [getDraftData, options.onSaveDraft]);

  const doAutosave = useCallback(async () => {
    await wrapSave(
      async () => {
        const data = getDraftDataRef.current();
        await onSaveDraftRef.current(data);
      },
      'draftManager/autosave'
    );
  }, [wrapSave]);

  useEffect(() => {
    if (timerStatus !== 'writing' && timerStatus !== 'paused') return;
    const timeout = setTimeout(() => void doAutosave(), 3_000);
    const interval = setInterval(() => void doAutosave(), 30_000);
    return () => { clearTimeout(timeout); clearInterval(interval); };
  }, [doAutosave, timerStatus]);

  useVisibilitySave(doAutosave, () => getDraftData().content);

  // D-2: guests (and cloud users via this manager) get a beforeunload/pagehide
  // localStorage fallback so closing the tab between 30s autosaves doesn't lose
  // recent typing.
  useSyncUnloadSave(
    userId ? ({ uid: userId } as User) : null,
    draftSnapshotRef as unknown as RefObject<{ pinnedThoughts: string[]; sessionStartTime?: number | undefined; activeSessionId: string | null; [key: string]: unknown }>,
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
