import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { WritingSessionService } from '../services/WritingSessionService';
import { WritingDraftService } from '../services/WritingDraftService';
import { useWritingStore } from '../store/useWritingStore';
import { useDraftAutosave } from './useDraftAutosave';
import { UserProfile, SessionPayload } from '../../../types';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { LocalVersionService } from '../services/LocalVersionService';
import { LocalSessionInfo } from './useGuestWritingSession';

export function useSessionPersistence(
  user: User | null,
  profile: UserProfile | null,
  sessionState: {
    title: string;
    content: string;
    pinnedThoughts: string[];
    tags: string[];
    sessionType: 'free' | 'stopwatch' | 'timer' | 'words' | 'finish-by';
    activeSessionId: string | null;
    initialDuration: number;
    initialWordCount: number;
    sessionStartTime: number | null;
  },
  timerState: {
    seconds: number;
    wpm: number;
    wordCount: number;
    status: 'idle' | 'writing' | 'paused' | 'finished';
    timeGoalReached: boolean;
    wordGoalReached: boolean;
  },
  actions: {
    setContent: (content: string) => void;
    setTitle: (title: string) => void;
    setPinnedThoughts: (thoughts: string[]) => void;
    setActiveSessionId: (id: string | null) => void;
    setHasDraft: (has: boolean) => void;
    resetSession: () => void;
    finishSession: () => void;
    setStatus: (status: 'idle' | 'writing' | 'paused' | 'finished') => void;
    setInitialWordCount: (count: number) => void;
    setInitialDuration: (duration: number) => void;
  }
) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const userId = user?.uid ?? '';
  const { saveStatus, lastSavedAt } = useDraftAutosave(user, {
    title: sessionState.title,
    content: sessionState.content,
    pinnedThoughts: sessionState.pinnedThoughts,
    seconds: timerState.seconds,
    wpm: timerState.wpm,
    wordCount: timerState.wordCount,
    initialWordCount: sessionState.initialWordCount,
    sessionStartTime: sessionState.sessionStartTime,
    activeSessionId: sessionState.activeSessionId,
    status: timerState.status
  });

  // Online status listener
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      WritingSessionService.syncPendingSessions(userId);
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [userId]);

  const sessionStateRef = useRef(sessionState);
  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  // Load draft
  const draftLoadedForRef = useRef<string | null>(null);
  const loadDraft = useCallback(async () => {
    if (draftLoadedForRef.current === userId) return;
    if (!userId) return;
    
    const draftToLoad = await WritingDraftService.loadDraft(userId);
    if (draftToLoad) {
      actions.setHasDraft(true);
      if (!useWritingStore.getState().content) {
        useWritingStore.setState({
          content: draftToLoad.content || '',
          title: draftToLoad.title || '',
          pinnedThoughts: draftToLoad.pinnedThoughts || [],
          initialWordCount: draftToLoad.initialWordCount || 0,
          seconds: draftToLoad.seconds || 0,
          wordCount: draftToLoad.wordCount || 0
        });
        if (draftToLoad.activeSessionId) actions.setActiveSessionId(draftToLoad.activeSessionId);
      }
      await WritingDraftService.clearLegacyDraft(userId);
    }
    draftLoadedForRef.current = userId;
  }, [userId, actions]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  const handleSave = async (isLocalOnly: boolean) => {
    const state = useWritingStore.getState();
    
    const sessionData: SessionPayload = {
      userId: userId,
      authorName: profile?.nickname || user?.displayName || user?.email?.split('@')[0] || 'Guest',
      authorPhoto: user?.photoURL || '',
      nickname: profile?.nickname || '',
      title: state.title,
      content: state.content,
      pinnedThoughts: state.pinnedThoughts,
      duration: state.seconds,
      wordCount: state.wordCount,
      charCount: state.content.length,
      wpm: state.wpm,
      tags: sessionState.tags,
      updatedAt: Timestamp.now(),
      sessionType: state.sessionType,
      sessionStartTime: sessionState.sessionStartTime,
      goalReached: state.sessionType === 'timer' ? state.timeGoalReached : (state.sessionType === 'words' ? state.wordGoalReached : true)
    };

    if (isLocalOnly) {
      const sessionKey = `local_session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(sessionKey, JSON.stringify(sessionData));
      await WritingDraftService.deleteDraft(userId);
      actions.setHasDraft(false);
      actions.finishSession();
      return;
    }

    try {
      const savedId = await WritingSessionService.saveSession(sessionData, sessionState.activeSessionId, isOnline, userId);
      if (savedId && !sessionState.activeSessionId) {
        actions.setActiveSessionId(savedId);
      }
      await WritingDraftService.deleteDraft(userId);
      actions.setHasDraft(false);
      actions.finishSession();
    } catch {
      // Error is handled in WritingSessionService
    }
  };

  const handleCancel = async () => {
    await WritingDraftService.deleteDraft(userId);
    actions.setHasDraft(false);
    actions.resetSession();
    actions.setStatus('idle');
  };

  const fetchLocalSessions = useCallback(async () => {
    const localDocs = await LocalDocumentService.getGuestDocuments(userId);
    return localDocs.map(d => ({
      id: d.id,
      createdAt: new Date(d.lastSessionAt),
      title: d.title,
      wordCount: d.totalWords,
      duration: d.totalDuration,
    })) as LocalSessionInfo[];
  }, [userId]);

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
    saveStatus,
    lastSavedAt,
    isOnline,
    handleSave,
    handleCancel,
    fetchLocalSessions,
    loadLocalSession,
    loadDraft
  };
}
