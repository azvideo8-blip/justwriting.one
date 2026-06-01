import { useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { useTimerStore } from '../store/useTimerStore';
import { buildLocalDraft, persistDraft } from '../utils/draftPersistence';
import { useDraftCore, useVisibilitySave, useSyncUnloadSave, type DraftSaveStatus } from './useDraftCore';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';

export function useDraftAutosave(
  user: User | null,
  draftData: {
    title: string;
    content: string;
    pinnedThoughts: string[];
    seconds: number;
    wpm: number;
    wordCount: number;
    initialWordCount?: number;
    sessionStartTime?: number;
    activeSessionId: string | null;
    status: 'idle' | 'writing' | 'paused';
  }
) {
  const userId = user?.uid ?? null;
  const { saveStatus, lastSavedAt, wrapSave } = useDraftCore({ userId });
  const draftDataRef = useRef(draftData);
  const { layoutMode } = useLayoutMode();

  useEffect(() => {
    draftDataRef.current = draftData;
  }, [draftData]);

  const doAutosave = useCallback(async () => {
    if (!user) return;
    const current = draftDataRef.current;
    const storeStatus = useTimerStore.getState().status;
    if (storeStatus !== 'writing' && storeStatus !== 'paused') return;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft);
    if (!result.localOk && !result.remoteOk) {
      throw new Error('Both local and remote save failed');
    }
  }, [user]);

  const doForceSave = useCallback(async () => {
    if (!user) return;
    const storeStatus = useTimerStore.getState().status;
    if (storeStatus === 'idle') return;
    const current = draftDataRef.current;
    if (current.status === 'idle') return;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft);
    if (!result.localOk && !result.remoteOk) {
      throw new Error('Both local and remote save failed');
    }
  }, [user]);

  const wrappedAutosave = useCallback(async () => {
    await wrapSave(doAutosave, 'draftAutosave/autoSave');
  }, [wrapSave, doAutosave]);

  const wrappedForceSave = useCallback(async () => {
    await wrapSave(doForceSave, 'draftAutosave/forceSave');
  }, [wrapSave, doForceSave]);

  useSyncUnloadSave(user, draftDataRef);
  useVisibilitySave(wrappedForceSave, () => draftDataRef.current.content);

  useEffect(() => {
    const currentStatus = useTimerStore.getState().status;
    if ((currentStatus === 'writing' || currentStatus === 'paused') && user) {
      const debounceDelay = layoutMode === 'mobile' ? 5000 : 500;
      const timeout = setTimeout(wrappedAutosave, debounceDelay);
      return () => clearTimeout(timeout);
    }
  }, [draftData.status, draftData.content, draftData.title, draftData.wordCount, user, wrappedAutosave, layoutMode]);

  return { saveStatus: saveStatus as DraftSaveStatus, lastSavedAt };
}
