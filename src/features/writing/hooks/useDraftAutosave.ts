import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { WritingDraftService } from '../services/WritingDraftService';
import { useWritingStore } from '../store/useWritingStore';
import { buildLocalDraft, persistDraft } from '../utils/draftPersistence';

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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const draftDataRef = useRef(draftData);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    draftDataRef.current = draftData;
  }, [draftData]);

  const markSaved = useCallback(() => {
    if (isMountedRef.current) {
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      setTimeout(() => { if (isMountedRef.current) setSaveStatus('idle'); }, 1000);
    }
  }, []);

  const forceSaveEverything = useCallback(async () => {
    if (!user) return;
    const current = draftDataRef.current;
    if (current.status === 'idle') return;
    const storeStatus = useWritingStore.getState().status;
    if (storeStatus === 'idle') return;

    const draft = buildLocalDraft(user, current);

    try {
      if (isMountedRef.current) setSaveStatus('saving');
      const result = await persistDraft(draft);
      if (isMountedRef.current) {
        if (result.localOk || result.remoteOk) {
          markSaved();
        } else {
          setSaveStatus('error');
        }
      }
    } catch (err) {
      const isQuotaError = err instanceof DOMException && err.name === 'QuotaExceededError';
      console.error(isQuotaError ? 'localStorage full' : 'Save error:', err);
      if (isMountedRef.current) setSaveStatus('error');
    }
  }, [user, markSaved]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        forceSaveEverything();
      }
    };

    const handleBeforeUnload = () => {
      const state = useWritingStore.getState();
      if (user && state.content.trim() && (state.status === 'writing' || state.status === 'paused')) {
        try {
          const key = `draft-${user.uid}`;
          localStorage.setItem(key, JSON.stringify({
            content: state.content,
            title: state.title,
            seconds: state.seconds,
            wordCount: state.wordCount,
            updatedAt: Date.now(),
          }));
        } catch { /* ignore */ }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [forceSaveEverything, user]);

  useEffect(() => {
    if ((draftData.status === 'writing' || draftData.status === 'paused') && user) {
      const timeout = setTimeout(async () => {
        if (useWritingStore.getState().status !== 'writing' &&
            useWritingStore.getState().status !== 'paused') return;

        const draft = buildLocalDraft(user, draftDataRef.current);
        try {
          await persistDraft(draft);
          markSaved();
        } catch (err) {
          const isQuotaError = err instanceof DOMException && err.name === 'QuotaExceededError';
          console.error(isQuotaError ? 'localStorage full' : 'Local autosave error:', err);
          if (isMountedRef.current) setSaveStatus('error');
        }
      }, 500);
      
      return () => clearTimeout(timeout);
    }
  }, [draftData.status, draftData.content, draftData.title, draftData.wordCount, draftData.seconds, user, markSaved]);

  return { saveStatus, lastSavedAt };
}
