import { useEffect, useCallback, useRef } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { useTimerStore } from '../store/useTimerStore';
import { buildLocalDraft, persistDraft } from '../utils/draftPersistence';
import { useDraftCore, useVisibilitySave, useSyncUnloadSave, type DraftSaveStatus } from './useDraftCore';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { WritingDraftService } from '../services/WritingDraftService';

export function useDraftAutosave(
  user: AppUser | null,
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
  const { saveStatus, lastSavedAt, remotePermanentError, wrapSave } = useDraftCore({ userId });
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
    // Deliberately returns nothing: `remote: false` makes persistDraft report
    // remoteOk=true (nothing was attempted, so nothing failed). Passing that up
    // would clear the cloud-stale flag on every keystroke pause.
  }, [user]);

  const doAutosaveRemote = useCallback(async () => {
    if (!user) return;
    const current = draftDataRef.current;
    const storeStatus = useTimerStore.getState().status;
    if (storeStatus !== 'writing' && storeStatus !== 'paused') return;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft, { remote: true });
    if (!result.localOk) {
      throw new Error('Local save failed');
    }
    return result;
  }, [user]);

  const doForceSave = useCallback(async () => {
    if (!user) return;
    const storeStatus = useTimerStore.getState().status;
    if (storeStatus === 'idle') return;
    const current = draftDataRef.current;
    if (current.status === 'idle') return;

    const draft = buildLocalDraft(user, current);
    const result = await persistDraft(draft, { remote: true });
    if (!result.localOk) {
      throw new Error('Local save failed');
    }
    return result;
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

  // Invalidate in-flight autosaves on unmount or when transitioning to idle
  useEffect(() => {
    return () => {
      if (userId) {
        WritingDraftService.bumpDraftGeneration(userId);
      }
    };
  }, [userId]);

  useEffect(() => {
    if (draftData.status === 'idle' && userId) {
      WritingDraftService.bumpDraftGeneration(userId);
    }
  }, [draftData.status, userId]);

  // Debounce: save LOCALLY shortly after the user stops typing to avoid cloud write-quota exhaustion.
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
    if (!user || remotePermanentError) return;
    const currentStatus = useTimerStore.getState().status;
    if (currentStatus !== 'writing' && currentStatus !== 'paused') return;
    const interval = setInterval(() => void wrappedAutosaveRemote(), 30_000);
    return () => clearInterval(interval);
  }, [user, wrappedAutosaveRemote, draftData.status, remotePermanentError]);

  return { saveStatus: saveStatus as DraftSaveStatus, lastSavedAt };
}
