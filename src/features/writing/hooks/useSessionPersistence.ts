import { useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { WritingSessionService } from '../services/WritingSessionService';
import { WritingDraftService } from '../services/WritingDraftService';
import { useWritingStore } from '../store/useWritingStore';
import { useDraftAutosave } from './useDraftAutosave';
import { UserProfile, SessionPayload } from '../../../types';
import { fetchLocalSessions as fetchLocalSessionsFromLoader, loadLocalSession as loadLocalSessionFromLoader } from '../services/LocalSessionLoader';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';

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
    status: 'idle' | 'writing' | 'paused';
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
    setStatus: (status: 'idle' | 'writing' | 'paused') => void;
    setInitialWordCount: (count: number) => void;
    setInitialDuration: (duration: number) => void;
  }
) {
  const isOnline = useOnlineStatus();
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

  useEffect(() => {
    if (isOnline) {
      WritingSessionService.syncPendingSessions(userId);
    }
  }, [isOnline, userId]);

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
        useWritingStore.getState().setSessionStart();
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
      tags: state.tags,
      updatedAt: Timestamp.now(),
      sessionType: state.sessionType,
sessionStartTime: state.sessionStartTime,
      goalReached: state.sessionType === 'timer' ? state.timeGoalReached : (state.sessionType === 'words' ? state.wordGoalReached : true)
    };

    if (isLocalOnly) {
      try {
        const keysToRemove: string[] = [];
        const sessionKeys: { key: string; ts: number }[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith('local_session_')) {
            const ts = parseInt(key.split('_')[2] || '0', 10);
            sessionKeys.push({ key, ts });
          }
        }
        sessionKeys.sort((a, b) => a.ts - b.ts);
        while (sessionKeys.length >= 20) {
          const oldest = sessionKeys.shift();
          if (oldest) keysToRemove.push(oldest.key);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      } catch { /* ignore */ }
      const sessionKey = `local_session_${Date.now()}_${crypto.randomUUID()}`;
      try {
        localStorage.setItem(sessionKey, JSON.stringify(sessionData));
      } catch (e) {
        console.error('[SessionPersistence] localStorage write failed:', e);
        return;
      }
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
    } catch (e) {
      console.error('[SessionPersistence] Save failed:', e);
      throw e;
    }
  };

  const handleCancel = async () => {
    await WritingDraftService.deleteDraft(userId);
    actions.setHasDraft(false);
    actions.resetSession();
    actions.setStatus('idle');
  };

  const fetchLocalSessions = useCallback(() => fetchLocalSessionsFromLoader(userId), [userId]);
  const loadLocalSession = useCallback((id: string) => loadLocalSessionFromLoader(id), []);

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
