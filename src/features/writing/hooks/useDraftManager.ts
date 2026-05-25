import { useEffect, useCallback, useRef } from 'react';
import { useTimerStore } from '../store/useTimerStore';
import { useDraftCore, useVisibilitySave, type DraftSaveStatus, type DraftErrorKind } from './useDraftCore';

export interface DraftData {
  content: string;
  title: string;
  pinnedThoughts: string[];
  seconds: number;
  wpm: number;
  wordCount: number;
  initialWordCount?: number;
  sessionStartTime?: number | null;
  activeSessionId?: string | null;
  tags?: string[];
  labelId?: string;
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

  useEffect(() => {
    getDraftDataRef.current = getDraftData;
    onSaveDraftRef.current = options.onSaveDraft;
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
    const interval = setInterval(doAutosave, 30_000);
    return () => clearInterval(interval);
  }, [doAutosave, timerStatus]);

  useVisibilitySave(doAutosave, () => getDraftData().content);

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
