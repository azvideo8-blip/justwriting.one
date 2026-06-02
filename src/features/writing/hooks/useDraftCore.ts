import { useState, useCallback, useRef, useEffect, type RefObject } from 'react';
import { User } from 'firebase/auth';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { reportError } from '../../../core/errors/reportError';

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type DraftErrorKind = 'quota' | 'unknown' | null;

interface UseDraftCoreOptions {
  userId: string | null;
  onError?: (err: unknown, action: string) => void;
}

export function useDraftCore({ userId, onError }: UseDraftCoreOptions) {
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>('idle');
  const [saveErrorKind, setSaveErrorKind] = useState<DraftErrorKind>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const isMountedRef = useRef(true);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const markSaving = useCallback(() => {
    if (isMountedRef.current) {
      setSaveStatus('saving');
      setSaveErrorKind(null);
    }
  }, []);

  const markSaved = useCallback(() => {
    if (isMountedRef.current) {
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      setSaveErrorKind(null);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) setSaveStatus('idle');
      }, 1000);
    }
  }, []);

  const markError = useCallback((err: unknown, action: string) => {
    const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
    if (isMountedRef.current) {
      setSaveStatus('error');
      setSaveErrorKind(isQuota ? 'quota' : 'unknown');
    }
    if (onError) {
      onError(err, action);
    } else if (isQuota) {
      reportError(err, { action, userId: userId ?? undefined }, 'warning');
    } else {
      reportError(err, { action, userId: userId ?? undefined });
    }
  }, [onError, userId]);

  const wrapSave = useCallback(async (saveFn: () => Promise<void>, action: string) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    try {
      markSaving();
      await saveFn();
      markSaved();
      return true;
    } catch (err) {
      markError(err, action);
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [markSaving, markSaved, markError]);

  return {
    saveStatus,
    saveErrorKind,
    lastSavedAt,
    isMountedRef,
    savingRef,
    markSaving,
    markSaved,
    markError,
    wrapSave,
  };
}

export function useVisibilitySave(doSave: () => Promise<void>, getContent: () => string) {
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      if (!getContent()) return;
      void doSave();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [doSave, getContent]);
}

export function useSyncUnloadSave(
  user: User | null,
  draftDataRef: RefObject<{
    pinnedThoughts: string[];
    sessionStartTime?: number | undefined;
    activeSessionId: string | null;
    [key: string]: unknown;
  }>
) {
  useEffect(() => {
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
            pinnedThoughts: draftDataRef.current.pinnedThoughts ?? [],
            sessionStartTime: draftDataRef.current.sessionStartTime ?? null,
            activeSessionId: draftDataRef.current.activeSessionId ?? null,
            tags: contentState.tags ?? [],
            labelId: contentState.labelId ?? undefined,
            updatedAt: Date.now(),
          }));
        } catch (e) {
          reportError(e, { action: 'autosave_beforeunload', userId: user.uid }, 'warning');
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [user, draftDataRef]);
}
