import { useCallback, useState, useEffect, useRef } from 'react';
import { useBaseWritingSession, BaseSessionReturn } from './useBaseWritingSession';
import { useWritingStore } from '../store/useWritingStore';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';
import { SaveData } from '../WritingFinishModal';
import { UnifiedSessionService } from '../services/UnifiedSessionService';

export interface GuestSessionReturn extends BaseSessionReturn {
  userId: string;
  isGuest: true;
  hasDraft: boolean;
  setHasDraft: (v: boolean) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
  isOnline: boolean;
  handleSave: (isLocalOnly: boolean) => Promise<void>;
  handleCancel: () => Promise<void>;
  fetchLocalSessions: () => { id: string; createdAt: Date; isEncrypted?: boolean; title?: string; wordCount?: number; duration?: number }[];
  loadLocalSession: (id: string) => Record<string, unknown> | null;
  decryptSession: (session: Record<string, unknown>, password: string) => Promise<Record<string, unknown>>;
  loadDraft: () => Promise<void>;
  onSaveComplete: (() => void) | null;
}

const DRAFT_KEY = 'jw_guest_draft';

export function useGuestWritingSession(): GuestSessionReturn {
  const base = useBaseWritingSession();
  const guestId = getOrCreateGuestId();
  const [hasDraft, setHasDraft] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [onSaveComplete, setOnSaveComplete] = useState<(() => void) | null>(null);
  const saveStatusRef = useRef(saveStatus);
  saveStatusRef.current = saveStatus;

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
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          content: base.content,
          title: base.title,
          pinnedThoughts: base.pinnedThoughts,
          seconds: base.seconds,
          wordCount: base.wordCount,
          timestamp: Date.now(),
        }));
        setSaveStatus('saved');
        setLastSavedAt(Date.now());
        setTimeout(() => setSaveStatus('idle'), 1000);
      } catch {
        setSaveStatus('error');
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [base.status, base.content, base.title, base.pinnedThoughts, base.seconds, base.wordCount]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && base.content) {
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({
            content: base.content,
            title: base.title,
            pinnedThoughts: base.pinnedThoughts,
            seconds: base.seconds,
            wordCount: base.wordCount,
            timestamp: Date.now(),
          }));
        } catch {}
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [base.content, base.title, base.pinnedThoughts, base.seconds, base.wordCount]);

  const loadDraft = useCallback(async () => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (!useWritingStore.getState().content && draft.content) {
        useWritingStore.setState({
          content: draft.content || '',
          title: draft.title || '',
          pinnedThoughts: draft.pinnedThoughts || [],
          seconds: draft.seconds || 0,
          wordCount: draft.wordCount || 0,
        });
        setHasDraft(true);
      }
    } catch {}
  }, []);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
  }, []);

  const handleSave = useCallback(async (_isLocalOnly: boolean) => {
    const state = useWritingStore.getState();
    const sessionSeconds = state.accumulatedDuration + (state.seconds - state.sessionStartSeconds);

    await UnifiedSessionService.saveAsNewDocument(guestId, {
      title: state.title || '',
      content: state.content,
      wordCount: state.wordCount,
      duration: sessionSeconds,
      wpm: state.wpm,
      isPublic: false,
      tags: state.tags,
      labelId: state.labelId,
      goalWords: state.wordGoal > 0 ? state.wordGoal : undefined,
      goalTime: state.timerDuration > 0 ? state.timerDuration : undefined,
      goalReached: state.wordGoal > 0 && state.wordCount >= state.wordGoal,
      sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
    }, 'local');

    clearDraft();
    base.finishSession();
    if (onSaveComplete) onSaveComplete();
  }, [guestId, base, clearDraft, onSaveComplete]);

  const handleCancel = useCallback(async () => {
    clearDraft();
    base.resetSession();
    base.setStatus('idle');
  }, [base, clearDraft]);

  const fetchLocalSessions = useCallback(() => {
    const sessions: { id: string; createdAt: Date; isEncrypted?: boolean; title?: string; wordCount?: number; duration?: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('local_session_')) {
        const raw = localStorage.getItem(key);
        try {
          const data = JSON.parse(raw || '{}');
          const timestamp = key.replace('local_session_', '').split('_')[0];
          sessions.push({
            id: key,
            createdAt: new Date(Number(timestamp)),
            isEncrypted: data.isEncrypted,
            title: data.title,
            wordCount: data.wordCount,
            duration: data.duration,
          });
        } catch {
          const fallbackTimestamp = key.replace('local_session_', '').split('_')[0];
          sessions.push({ id: key, createdAt: new Date(Number(fallbackTimestamp)) });
        }
      }
    }
    return sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, []);

  const loadLocalSession = useCallback((key: string) => {
    const raw = localStorage.getItem(key);
    try {
      return JSON.parse(raw || '{}');
    } catch {
      return null;
    }
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
    lastSavedAt,
    isOnline,
    handleSave,
    handleCancel,
    fetchLocalSessions,
    loadLocalSession,
    decryptSession,
    loadDraft,
    onSaveComplete,
  };
}
