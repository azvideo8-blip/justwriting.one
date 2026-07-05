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
    initialWordCount?: number | undefined;
    sessionStartTime?: number | undefined;
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

  const doAutosaveLocal = useCallback(async () => {
    if (!user) return;
    const current = draftDataRef.current;
    const storeStatus = useTimerStore.getState().status;
    if (storeStatus !== 'writing' && storeStatus !== 'paused') return;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft, { remote: false });
    if (!result.localOk) {
      throw new Error('Local save failed');
    }
  }, [user]);

  const doAutosaveRemote = useCallback(async () => {
    if (!user) return;
    const current = draftDataRef.current;
    const storeStatus = useTimerStore.getState().status;
    if (storeStatus !== 'writing' && storeStatus !== 'paused') return;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft, { remote: true });
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
    const result = await persistDraft(draft, { remote: true });
    if (!result.localOk && !result.remoteOk) {
      throw new Error('Both local and remote save failed');
    }
  }, [user]);

  const wrappedAutosaveLocal = useCallback(async () => {
    await wrapSave(doAutosaveLocal, 'draftAutosave/autoSaveLocal');
  }, [wrapSave, doAutosaveLocal]);

  const wrappedAutosaveRemote = useCallback(async () => {
    await wrapSave(doAutosaveRemote, 'draftAutosave/autoSave');
  }, [wrapSave, doAutosaveRemote]);

  const wrappedForceSave = useCallback(async () => {
    await wrapSave(doForceSave, 'draftAutosave/forceSave');
  }, [wrapSave, doForceSave]);

  useSyncUnloadSave(user, draftDataRef);
  useVisibilitySave(wrappedForceSave, () => draftDataRef.current.content);

  // Debounce: save LOCALLY shortly after the user stops typing to avoid Firestore quota exhaustion.
  useEffect(() => {
    const currentStatus = useTimerStore.getState().status;
    if ((currentStatus === 'writing' || currentStatus === 'paused') && user) {
      const debounceDelay = layoutMode === 'mobile' ? 5000 : 500;
      const timeout = setTimeout(() => void wrappedAutosaveLocal(), debounceDelay);
      return () => clearTimeout(timeout);
    }
  }, [draftData.status, draftData.content, draftData.title, draftData.wordCount, user, wrappedAutosaveLocal, layoutMode]);

  // Interval safety net: save to cloud (remote) every 30s even if the user types continuously.
  useEffect(() => {
    if (!user) return;
    const currentStatus = useTimerStore.getState().status;
    if (currentStatus !== 'writing' && currentStatus !== 'paused') return;
    const interval = setInterval(() => void wrappedAutosaveRemote(), 30_000);
    return () => clearInterval(interval);
  }, [user, wrappedAutosaveRemote, draftData.status]);

  return { saveStatus: saveStatus as DraftSaveStatus, lastSavedAt };
}
