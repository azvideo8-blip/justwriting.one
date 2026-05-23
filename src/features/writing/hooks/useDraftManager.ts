import { useState, useEffect, useCallback, useRef } from 'react';
import { useTimerStore } from '../store/useTimerStore';
import { reportError } from '../../../core/errors/reportError';

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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorKind, setSaveErrorKind] = useState<'quota' | 'unknown' | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const isMountedRef = useRef(true);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const timerStatus = useTimerStore(s => s.status);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const doAutosave = useCallback(async () => {
    if (!userId) return;
    const currentStatus = useTimerStore.getState().status;
    if (currentStatus === 'idle') return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const data = getDraftData();
      await options.onSaveDraft(data);
      if (isMountedRef.current) {
        setSaveStatus('saved');
        setLastSavedAt(Date.now());
        setSaveErrorKind(null);
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setSaveStatus('idle');
        }, 1000);
      }
    } catch (err) {
      const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
      if (isMountedRef.current) {
        setSaveStatus('error');
        setSaveErrorKind(isQuota ? 'quota' : 'unknown');
      }
      if (!isQuota) reportError(err, { action: 'draftManager/autosave' });
    } finally {
      savingRef.current = false;
    }
  }, [userId, getDraftData, options.onSaveDraft]);

  useEffect(() => {
    if (timerStatus !== 'writing' && timerStatus !== 'paused') return;
    const interval = setInterval(doAutosave, 30_000);
    return () => clearInterval(interval);
  }, [doAutosave, timerStatus]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      const current = getDraftData();
      if (!current.content) return;
      doAutosave();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [doAutosave, getDraftData]);

  const forceSave = useCallback(async () => {
    await doAutosave();
  }, [doAutosave]);

  return {
    saveStatus,
    saveErrorKind,
    lastSavedAt,
    forceSave,
  };
}
