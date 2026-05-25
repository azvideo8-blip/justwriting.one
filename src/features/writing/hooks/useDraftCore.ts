import { useState, useCallback, useRef, useEffect } from 'react';
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
      doSave();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [doSave, getContent]);
}
