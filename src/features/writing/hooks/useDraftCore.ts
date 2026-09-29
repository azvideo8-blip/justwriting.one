import { useState, useCallback, useRef, useEffect, type RefObject } from 'react';
import type { AppUser } from '../../../core/auth/types';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { reportError } from '../../../shared/errors/reportError';
import { useEncryptionStore } from '../../../core/crypto/useEncryptionStore';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';
import { isAccountReloadPending } from '../../../core/auth/accountReload';


export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'cloud-stale' | 'error';
export type DraftErrorKind = 'quota' | 'unknown' | null;

/** What a save reports back. Omitting `remoteOk` means "no remote save was attempted". */
export interface DraftSaveOutcome {
  localOk?: boolean;
  localSkipped?: boolean;
  remoteOk?: boolean;
  remoteError?: unknown;
}

interface UseDraftCoreOptions {
  userId: string | null;
  onError?: (err: unknown, action: string) => void;
}

const PERMANENT_ERRORS = new Set([
  'permission-denied',
  'unauthenticated',
  'invalid-argument',
  'failed-precondition',
  '23514', // Postgres check_violation (e.g. drafts_title_check / drafts_content_check)
  '42501', // Postgres insufficient_privilege
  '400',
  '401',
  '403',
  'PGRST100',
]);

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
  // Сохранение, пришедшее во время другого: раньше оно просто отбрасывалось, и
  // «Сохранено» подтверждало текст без последнего абзаца (R3-019).
  const rerunRef = useRef<{ saveFn: () => Promise<DraftSaveOutcome | void>; action: string } | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  // Таймер «Сохранено → пусто» от прошлого сохранения не должен гасить
  // «сохраняется» и «ошибку» нового (R3-018).
  const clearStatusTimer = () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
  };

  const markSaving = useCallback(() => {
    clearStatusTimer();
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
    clearStatusTimer();
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

  const wrapSave = useCallback(async (saveFn: () => Promise<DraftSaveOutcome | void>, action: string): Promise<boolean> => {
    if (savingRef.current) {
      rerunRef.current = { saveFn, action };
      return false;
    }
    savingRef.current = true;
    try {
      markSaving();
      const res = await saveFn();

      // N-33: запись пропущена (черновик устарел) — это не «Сохранено».
      if (res && res.localSkipped) {
        if (isMountedRef.current) setSaveStatus('idle');
        return false;
      }

      // A local-only save resolves with no remote information at all. It must
      // fall through both branches: it neither proves the cloud copy is current
      // nor that it is stale, so it leaves the sticky flag exactly as it was.
      if (res && res.remoteOk === false) {
        const err = res.remoteError as { code?: unknown; status?: unknown; message?: unknown; details?: unknown } | undefined;
        const code = typeof err?.code === 'string' ? err.code : typeof err?.code === 'number' ? String(err.code) : undefined;
        const status = typeof err?.status === 'string' ? err.status : typeof err?.status === 'number' ? String(err.status) : undefined;
        const message = typeof err?.message === 'string' ? err.message : '';
        const details = typeof err?.details === 'string' ? err.details : '';

        const isPermanent = (code !== undefined && PERMANENT_ERRORS.has(code)) ||
          (status !== undefined && PERMANENT_ERRORS.has(status)) ||
          message.includes('check constraint') ||
          message.includes('23514') ||
          details.includes('check constraint');

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
      const rerun = rerunRef.current;
      rerunRef.current = null;
      if (rerun && isMountedRef.current) void wrapSaveRef.current(rerun.saveFn, rerun.action);
    }
  }, [markSaving, markSaved, markError]);
  const wrapSaveRef = useRef(wrapSave);
  useEffect(() => { wrapSaveRef.current = wrapSave; }, [wrapSave]);

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
  user: AppUser | null,
  draftDataRef: RefObject<{
    pinnedThoughts: string[];
    sessionStartTime?: number | undefined;
    activeSessionId: string | null;
    [key: string]: unknown;
  }>
) {
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isAccountReloadPending()) return;
      const contentState = useContentStore.getState();
      const timerState_ = useTimerStore.getState();
      const meta = useSessionMetaStore.getState();
      const isPristine = Boolean(
        meta.savedDocumentId &&
        meta.loadedContent !== null &&
        contentState.content === meta.loadedContent &&
        (meta.loadedTitle ?? '') === contentState.title
      );
      if (user && !isPristine && (contentState.content.trim() || contentState.title.trim())) {
        try {
          // Гостевой фолбэк обязан попадать в ключ, который реально читается
          // при возврате (GuestDraftService → STORAGE_KEYS.GUEST_DRAFT).
          // Прежний `draft-guest_<uuid>` никто не читал — «защита» была
          // декоративной.
          const isGuest = user.uid.startsWith('guest');
          const key = isGuest ? STORAGE_KEYS.GUEST_DRAFT : `draft-${user.uid}`;
          const { getEncryptionEnabled } = useEncryptionStore.getState();
          if (!isGuest && getEncryptionEnabled(user.uid)) {
            // SEC-56: E2E is enabled — skip writing unencrypted draft to localStorage and clean legacy key
            localStorage.removeItem(`draft-${user.uid}`);
            return;
          }
          localStorage.setItem(key, JSON.stringify({
            content: contentState.content,
            title: contentState.title,
            seconds: timerState_.seconds,
            status: timerState_.status,
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
