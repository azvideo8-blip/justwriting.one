import { useCallback, useState, useEffect, useRef } from 'react';
import { useBaseWritingSession, BaseSessionReturn } from './useBaseWritingSession';
import { useWritingStore } from '../store/useWritingStore';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { LocalVersionService } from '../services/LocalVersionService';

export interface LocalSessionInfo {
  id: string;
  createdAt: Date;
  isEncrypted?: boolean;
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
  decryptSession: (session: Record<string, unknown>, password: string) => Promise<Record<string, unknown>>;
  loadDraft: () => Promise<void>;
}

const DRAFT_KEY = 'jw_guest_draft';

export function useGuestWritingSession(): GuestSessionReturn {
  const base = useBaseWritingSession();
  const guestId = getOrCreateGuestId();
  const [hasDraft, setHasDraft] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveErrorKind, setSaveErrorKind] = useState<'quota' | 'unknown' | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const saveStatusRef = useRef(saveStatus);
  saveStatusRef.current = saveStatus;

  const stateRef = useRef({ content: base.content, title: base.title, pinnedThoughts: base.pinnedThoughts, seconds: base.seconds, wordCount: base.wordCount });
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
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          content: s.content,
          title: s.title,
          pinnedThoughts: s.pinnedThoughts,
          seconds: s.seconds,
          wordCount: s.wordCount,
          timestamp: Date.now(),
        }));
        setSaveStatus('saved');
        setLastSavedAt(Date.now());
        setTimeout(() => setSaveStatus('idle'), 1000);
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
          localStorage.setItem(DRAFT_KEY, JSON.stringify({
            content: s.content,
            title: s.title,
            pinnedThoughts: s.pinnedThoughts,
            seconds: s.seconds,
            wordCount: s.wordCount,
            timestamp: Date.now(),
          }));
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
    if (!raw) return;

    let draft: { content?: string; title?: string; pinnedThoughts?: string[]; seconds?: number; wordCount?: number };
    try {
      draft = JSON.parse(raw);
    } catch (err) {
      console.warn('[GuestDraft] Corrupted draft, removing:', err);
      localStorage.removeItem(DRAFT_KEY);
      return;
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
      isPublic: false,
    } as Record<string, unknown>;
  }, []);

  const decryptSession = useCallback(async (_session: Record<string, unknown>, _password: string) => {
    throw new Error('Decryption not supported for guest sessions');
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
    decryptSession,
    loadDraft,
  };
}
