import { useState, useCallback, useRef, useEffect, type RefObject } from 'react';
import { User } from 'firebase/auth';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { reportError } from '../../../shared/errors/reportError';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';


export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'cloud-stale' | 'error';
export type DraftErrorKind = 'quota' | 'unknown' | null;

/** What a save reports back. Omitting `remoteOk` means "no remote save was attempted". */
export interface DraftSaveOutcome {
  localOk?: boolean;
  remoteOk?: boolean;
  remoteError?: unknown;
}

interface UseDraftCoreOptions {
  userId: string | null;
  onError?: (err: unknown, action: string) => void;
}

const PERMANENT_ERRORS = new Set(['permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition']);

export function useDraftCore({ userId, onError }: UseDraftCoreOptions) {
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>('idle');
  const [saveErrorKind, setSaveErrorKind] = useState<DraftErrorKind>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [remotePermanentError, setRemotePermanentError] = useState(false);
  // Refs, not state: wrapSave reads and writes these within a single call, so
  // they must be current immediately rather than after the next render.
  const remoteFailCountRef = useRef(0);
  // Sticky. Only a remote save that actually succeeded clears it — a local-only
  // save carries no information about the cloud copy and must not reset it.
  const cloudStaleRef = useRef(false);
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

  const markSaved = useCallback((isCloudStale = false) => {
    if (isMountedRef.current) {
      setSaveStatus(isCloudStale ? 'cloud-stale' : 'saved');
      setLastSavedAt(Date.now());
      setSaveErrorKind(null);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      // "Saved" is transient — it confirms one write and fades. The stale
      // warning is a standing condition, so it must not fade back to a blank
      // indicator that reads as "everything is fine".
      if (!isCloudStale) {
        statusTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setSaveStatus('idle');
        }, 1000);
      }
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

  const wrapSave = useCallback(async (saveFn: () => Promise<DraftSaveOutcome | void>, action: string) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    try {
      markSaving();
      const res = await saveFn();

      // A local-only save resolves with no remote information at all. It must
      // fall through both branches: it neither proves the cloud copy is current
      // nor that it is stale, so it leaves the sticky flag exactly as it was.
      if (res && res.remoteOk === false) {
        const code = (res.remoteError as { code?: unknown } | undefined)?.code;
        const isPermanent = typeof code === 'string' && PERMANENT_ERRORS.has(code);
        if (isPermanent) setRemotePermanentError(true);

        remoteFailCountRef.current += 1;
        if (isPermanent || remoteFailCountRef.current >= 3) {
          cloudStaleRef.current = true;
        }
      } else if (res && res.remoteOk === true) {
        remoteFailCountRef.current = 0;
        cloudStaleRef.current = false;
        setRemotePermanentError(false);
      }

      markSaved(cloudStaleRef.current);
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
    remotePermanentError,
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
          const { getEncryptionEnabled } = useEncryptionStore.getState();
          if (getEncryptionEnabled(user.uid)) {
            // SEC-56: E2E is enabled — skip writing unencrypted draft to localStorage and clean legacy key
            localStorage.removeItem(key);
            return;
          }
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
