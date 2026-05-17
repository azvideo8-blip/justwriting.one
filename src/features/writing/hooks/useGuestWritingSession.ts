import { useCallback, useState, useEffect, useRef } from 'react';
import { useBaseWritingSession } from './useBaseWritingSession';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { loadDraftIntoStore } from '../store/storeActions';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';
import { fetchLocalSessions, loadLocalSession } from '../services/LocalSessionLoader';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { LocalSessionInfo } from '../types/session';
import {
  saveGuestDraftToStorage,
  loadGuestDraftFromStorage,
  deleteGuestDraftFromStorage,
} from '../services/GuestDraftService';

export interface GuestSessionReturn extends ReturnType<typeof useBaseWritingSession> {
  userId: string;
  isGuest: true;
  hasDraft: boolean;
  setHasDraft: (v: boolean) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveErrorKind: 'quota' | 'unknown' | null;
  lastSavedAt: number | null;
  isOnline: boolean;
  handleCancel: () => Promise<void>;
  fetchLocalSessions: () => Promise<LocalSessionInfo[]>;
  loadLocalSession: (id: string) => Promise<Record<string, unknown> | null>;
  loadDraft: () => Promise<void>;
  restoreDraft: () => Promise<void>;
  discardDraft: () => void;
}

export function useGuestWritingSession(): GuestSessionReturn {
  const base = useBaseWritingSession();
  const guestId = getOrCreateGuestId();
  const [hasDraft, setHasDraft] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorKind, setSaveErrorKind] = useState<'quota' | 'unknown' | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const isOnline = useOnlineStatus();
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const _savingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const stateRef = useRef({ content: base.content, title: base.title, pinnedThoughts: base.pinnedThoughts, seconds: base.seconds, wordCount: base.wordCount });
  stateRef.current = { content: base.content, title: base.title, pinnedThoughts: base.pinnedThoughts, seconds: base.seconds, wordCount: base.wordCount };

  const doAutosave = useCallback(async () => {
    const currentStatus = useTimerStore.getState().status;
    if (currentStatus === 'idle') return;
    if (_savingRef.current) return;
    _savingRef.current = true;
    try {
      const s = stateRef.current;
      await saveGuestDraftToStorage({
        content: s.content,
        title: s.title,
        pinnedThoughts: s.pinnedThoughts,
        seconds: s.seconds,
        wordCount: s.wordCount,
        timestamp: Date.now(),
      });
      if (isMountedRef.current) {
        setSaveStatus('saved');
        setLastSavedAt(Date.now());
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setSaveStatus('idle');
        }, 1000);
      }
    } catch (err) {
      const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
      setSaveStatus('error');
      setSaveErrorKind(isQuota ? 'quota' : 'unknown');
      console.error('[GuestAutosave] Save failed:', err);
    } finally {
      _savingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (base.status !== 'writing' && base.status !== 'paused') return;
    const interval = setInterval(doAutosave, 30_000);
    return () => clearInterval(interval);
  }, [base.status, doAutosave]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'hidden' || !stateRef.current.content) return;
      doAutosave();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [doAutosave]);

  const clearDraft = useCallback(async () => {
    await deleteGuestDraftFromStorage();
    setHasDraft(false);
  }, []);

  const loadDraft = useCallback(async () => {
    const draft = await loadGuestDraftFromStorage();
    if (!draft?.content) return;

    const currentContent = useContentStore.getState().content;
    if (currentContent.length > 0) {
      setHasDraft(true);
      return;
    }

    loadDraftIntoStore({
      content: draft.content,
      title: draft.title ?? '',
      wordCount: draft.wordCount ?? 0,
    });
    useContentStore.setState({
      pinnedThoughts: draft.pinnedThoughts ?? [],
    });
    useTimerStore.setState({
      seconds: draft.seconds ?? 0,
    });
    setHasDraft(false);
  }, []);

  const restoreDraft = useCallback(async () => {
    const draft = await loadGuestDraftFromStorage();
    if (!draft?.content) { setHasDraft(false); return; }

    loadDraftIntoStore({
      content: draft.content,
      title: draft.title ?? '',
      wordCount: draft.wordCount ?? 0,
    });
    useContentStore.setState({
      pinnedThoughts: draft.pinnedThoughts ?? [],
    });
    useTimerStore.setState({
      seconds: draft.seconds ?? 0,
    });
    setHasDraft(false);
  }, []);

  const handleCancel = useCallback(async () => {
    clearDraft();
    base.resetSession();
    base.setStatus('idle');
  }, [base, clearDraft]);

  const fetchLocalSessionsCb = useCallback(() => fetchLocalSessions(guestId), [guestId]);
  const loadLocalSessionCb = useCallback((id: string) => loadLocalSession(id), []);

  return {
    ...base,
    userId: guestId,
    isGuest: true as const,
    hasDraft,
    setHasDraft,
    saveStatus,
    saveErrorKind,
    lastSavedAt,
    isOnline,
    handleCancel,
    fetchLocalSessions: fetchLocalSessionsCb,
    loadLocalSession: loadLocalSessionCb,
    loadDraft,
    restoreDraft,
    discardDraft: clearDraft,
  };
}
