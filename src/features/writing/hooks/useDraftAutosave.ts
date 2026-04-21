import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { saveToLocal, saveToFirestore, Draft } from '../../../lib/db';
import { useWritingStore } from '../store/useWritingStore';

function getLocalStorageUsageKB(): number {
  let total = 0;
  for (const key in localStorage) {
    if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
      total += (localStorage[key].length + key.length) * 2; // UTF-16
    }
  }
  return total / 1024;
}

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
    status: 'idle' | 'writing' | 'paused' | 'finished';
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

  const forceSaveEverything = useCallback(async () => {
    if (!user) return;
    const draft: Draft = {
      userId: user.uid,
      ...draftDataRef.current,
      sessionStartTime: draftDataRef.current.sessionStartTime ?? null,
      updatedAt: Date.now()
    } as Draft;
    try {
      if (isMountedRef.current) setSaveStatus('saving');
      
      const usageKB = getLocalStorageUsageKB();
      if (usageKB > 4500) { // ~4.5MB
        console.warn(`localStorage usage: ${usageKB.toFixed(0)}KB — approaching limit`);
      }

      const [localResult, remoteResult] = await Promise.allSettled([
        saveToLocal(draft),
        saveToFirestore(draft)
      ]);

      const localOk = localResult.status === 'fulfilled';
      const remoteOk = remoteResult.status === 'fulfilled';

      if (!localOk) {
        console.error('Local save failed:', localResult.reason);
      }
      if (!remoteOk) {
        console.warn('Firestore save failed (will retry on next change):', remoteResult.reason);
      }

      if (isMountedRef.current) {
        if (localOk || remoteOk) {
          setSaveStatus('saved');
          setLastSavedAt(Date.now());
          setTimeout(() => { if (isMountedRef.current) setSaveStatus('idle'); }, 1000);
        } else {
          setSaveStatus('error');
        }
      }
    } catch (err) {
      const isQuotaError = err instanceof DOMException && err.name === 'QuotaExceededError';
      console.error(isQuotaError ? 'localStorage full' : 'Save error:', err);
      if (isMountedRef.current) setSaveStatus('error');
    }
  }, [user]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        forceSaveEverything();
      }
    };

    const handleBeforeUnload = () => {
      const state = useWritingStore.getState();
      if (user && state.content) {
        try {
          const key = `draft-${user.uid}`;
          localStorage.setItem(key, JSON.stringify({
            content: state.content,
            title: state.title,
            seconds: state.seconds,
            wordCount: state.wordCount,
            timestamp: Date.now(),
          }));
        } catch {}
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [forceSaveEverything]);

  useEffect(() => {
    if ((draftData.status === 'writing' || draftData.status === 'paused') && user) {
      const timeout = setTimeout(async () => {
        const draft: Draft = {
          userId: user.uid,
          ...draftData,
          sessionStartTime: draftData.sessionStartTime ?? null,
          updatedAt: Date.now()
        } as Draft;
        try {
          const usageKB = getLocalStorageUsageKB();
          if (usageKB > 4500) {
            console.warn(`localStorage usage: ${usageKB.toFixed(0)}KB — approaching limit`);
          }
          await saveToLocal(draft);
          if (isMountedRef.current) {
            setSaveStatus('saved');
            setLastSavedAt(Date.now());
            setTimeout(() => { if (isMountedRef.current) setSaveStatus('idle'); }, 1000);
          }
        } catch (err) {
          const isQuotaError = err instanceof DOMException && err.name === 'QuotaExceededError';
          console.error(isQuotaError ? 'localStorage full' : 'Local autosave error:', err);
          if (isMountedRef.current) setSaveStatus('error');
        }
      }, 500); // Save 500ms after last change
      
      return () => clearTimeout(timeout);
    }
  }, [draftData, user]);

  return { saveStatus, lastSavedAt };
}
