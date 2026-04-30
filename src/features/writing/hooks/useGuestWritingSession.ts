import { useCallback, useState, useEffect, useRef } from 'react';
import { useBaseWritingSession, BaseSessionReturn } from './useBaseWritingSession';
import { useWritingStore } from '../store/useWritingStore';
import { getOrCreateGuestId, getLocalDb } from '../../../shared/lib/localDb';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { LocalVersionService } from '../services/LocalVersionService';

export interface LocalSessionInfo {
  id: string;
  createdAt: Date;
  title?: string;
  wordCount?: number;
  duration?: number;
}

export interface GuestSessionReturn extends BaseSessionReturn {
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
}

const DRAFT_KEY = 'jw_guest_draft';

async function saveDraftToIdb(draft: Record<string, unknown>) {
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      await db.put('drafts', { ...draft, userId: 'guest_draft' } as import('../../../shared/lib/localDb').LocalDraft);
    }
  } catch { /* ignore */ }
}

async function loadDraftFromIdb(): Promise<Record<string, unknown> | null> {
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      const d = await db.get('drafts', 'guest_draft');
      return d ? { ...d } as Record<string, unknown> : null;
    }
  } catch { /* ignore */ }
  return null;
}

async function deleteDraftFromIdb() {
  try {
    const db = await getLocalDb();
    if (db.objectStoreNames.contains('drafts')) {
      await db.delete('drafts', 'guest_draft');
    }
  } catch { /* ignore */ }
}

export function useGuestWritingSession(): GuestSessionReturn {
  const base = useBaseWritingSession();
  const guestId = getOrCreateGuestId();
  const [hasDraft, setHasDraft] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorKind, setSaveErrorKind] = useState<'quota' | 'unknown' | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const saveStatusRef = useRef(saveStatus);
  // eslint-disable-next-line react-hooks/refs
  saveStatusRef.current = saveStatus;
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  const stateRef = useRef({ content: base.content, title: base.title, pinnedThoughts: base.pinnedThoughts, seconds: base.seconds, wordCount: base.wordCount });
  // eslint-disable-next-line react-hooks/refs
  stateRef.current = { content: base.content, title: base.title, pinnedThoughts: base.pinnedThoughts, seconds: base.seconds, wordCount: base.wordCount };

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (base.status !== 'writing' && base.status !== 'paused') return;
    const interval = setInterval(() => {
      try {
        const s = stateRef.current;
        const draftData = {
          content: s.content,
          title: s.title,
          pinnedThoughts: s.pinnedThoughts,
          seconds: s.seconds,
          wordCount: s.wordCount,
          timestamp: Date.now(),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
        saveDraftToIdb(draftData);
        if (isMountedRef.current) {
          setSaveStatus('saved');
          setLastSavedAt(Date.now());
          statusTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) setSaveStatus('idle');
          }, 1000);
        }
      } catch (err) {
        const isQuota = err instanceof DOMException && err.name === 'QuotaExceededError';
        setSaveStatus('error');
        setSaveErrorKind(isQuota ? 'quota' : 'unknown');
        console.error('[GuestAutosave] Save failed:', err);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [base.status]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && stateRef.current.content) {
        try {
          const s = stateRef.current;
          const draftData = {
            content: s.content,
            title: s.title,
            pinnedThoughts: s.pinnedThoughts,
            seconds: s.seconds,
            wordCount: s.wordCount,
            timestamp: Date.now(),
          };
          localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
          saveDraftToIdb(draftData);
        } catch (err) {
          console.error('[GuestDraft] Emergency save on visibility change failed:', err);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const loadDraft = useCallback(async () => {
    const raw = localStorage.getItem(DRAFT_KEY);
    let draft: { content?: string; title?: string; pinnedThoughts?: string[]; seconds?: number; wordCount?: number } | null = null;

    if (raw) {
      try {
        draft = JSON.parse(raw);
      } catch (err) {
        console.warn('[GuestDraft] Corrupted localStorage draft, removing:', err);
        localStorage.removeItem(DRAFT_KEY);
      }
    }

    if (!draft) {
      const idbDraft = await loadDraftFromIdb();
      if (idbDraft) {
        draft = idbDraft as { content?: string; title?: string; pinnedThoughts?: string[]; seconds?: number; wordCount?: number };
      }
    }

    if (!draft?.content) return;

    const currentContent = useWritingStore.getState().content;
    if (currentContent.length > 0) {
      setHasDraft(true);
      return;
    }

    useWritingStore.setState({
      content: draft.content,
      title: draft.title ?? '',
      pinnedThoughts: draft.pinnedThoughts ?? [],
      seconds: draft.seconds ?? 0,
      wordCount: draft.wordCount ?? 0,
    });
    setHasDraft(false);
  }, []);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
    deleteDraftFromIdb();
    setHasDraft(false);
  }, []);

  const handleCancel = useCallback(async () => {
    clearDraft();
    base.resetSession();
    base.setStatus('idle');
  }, [base, clearDraft]);

  const fetchLocalSessions = useCallback(async () => {
    const localDocs = await LocalDocumentService.getGuestDocuments(guestId);
    return localDocs.map(d => ({
      id: d.id,
      createdAt: new Date(d.lastSessionAt),
      title: d.title,
      wordCount: d.totalWords,
      duration: d.totalDuration,
    }));
  }, [guestId]);

  const loadLocalSession = useCallback(async (docId: string) => {
    const doc = await LocalDocumentService.getDocument(docId);
    if (!doc) return null;
    const content = await LocalVersionService.getLatestContent(docId);
    return {
      content,
      title: doc.title,
      wordCount: doc.totalWords,
      duration: doc.totalDuration,
      tags: doc.tags,
    } as Record<string, unknown>;
  }, []);

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
    fetchLocalSessions,
    loadLocalSession,
    loadDraft,
  };
}
