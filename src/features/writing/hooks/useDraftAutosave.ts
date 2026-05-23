import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { buildLocalDraft, persistDraft } from '../utils/draftPersistence';
import { reportError } from '../../../core/errors/reportError';

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
    const storeStatus = useTimerStore.getState().status;
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
      const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
      if (isQuota) {
        reportError(err, { action: 'autosave_quota_exceeded', userId: user.uid }, 'warning');
      } else {
        reportError(err, { action: 'draftAutosave/forceSave', userId: user.uid });
      }
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
      const contentState = useContentStore.getState();
      const timerState_ = useTimerStore.getState();
      if (user && contentState.content.trim() && (timerState_.status === 'writing' || timerState_.status === 'paused')) {
        try {
          const key = `draft-${user.uid}`;
          localStorage.setItem(key, JSON.stringify({
            content: contentState.content,
            title: contentState.title,
            seconds: timerState_.seconds,
            wordCount: contentState.wordCount,
            updatedAt: Date.now(),
          }));
        } catch (e) {
          reportError(e, { action: 'autosave_beforeunload', userId: user.uid }, 'warning');
        }
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
    const currentStatus = useTimerStore.getState().status;
    if ((currentStatus === 'writing' || currentStatus === 'paused') && user) {
      const timeout = setTimeout(async () => {
        const latestStatus = useTimerStore.getState().status;
        if (latestStatus !== 'writing' && latestStatus !== 'paused') return;

        const draft = buildLocalDraft(user, draftDataRef.current);
        try {
          await persistDraft(draft);
          markSaved();
        } catch (err) {
          const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
          if (isQuota) {
            reportError(err, { action: 'autosave_quota_exceeded', userId: user.uid }, 'warning');
          } else {
            reportError(err, { action: 'draftAutosave/autoSave', userId: user.uid });
          }
          if (isMountedRef.current) setSaveStatus('error');
        }
      }, 500);
      
      return () => clearTimeout(timeout);
    }
  }, [draftData.status, draftData.content, draftData.title, draftData.wordCount, user, markSaved]);

  return { saveStatus, lastSavedAt };
}
