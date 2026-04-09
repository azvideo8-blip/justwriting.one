import { useState, useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { WritingSessionService } from '../services/WritingSessionService';
import { WritingDraftService } from '../services/WritingDraftService';
import { useWritingStore } from '../store/useWritingStore';
import { useDraftAutosave } from './useDraftAutosave';
import { encrypt, decrypt } from '../../../shared/lib/encryption';
import { UserProfile, SessionPayload } from '../../../types';

export function useSessionPersistence(
  user: User,
  profile: UserProfile | null,
  sessionState: {
    title: string;
    content: string;
    pinnedThoughts: string[];
    isPublic: boolean;
    isAnonymous: boolean;
    tags: string[];
    sessionType: 'stopwatch' | 'timer' | 'words' | 'finish-by';
    activeSessionId: string | null;
    encryptionPassword: string;
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
    setStatus: (status: 'idle' | 'writing' | 'paused' | 'finished') => void;
    setInitialWordCount: (count: number) => void;
    setInitialDuration: (duration: number) => void;
  }
) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
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
      WritingSessionService.syncPendingSessions(user.uid);
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user.uid]);

  const sessionStateRef = useRef(sessionState);
  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  // Load draft
  const draftLoadedForRef = useRef<string | null>(null);
  const loadDraft = useCallback(async () => {
    if (draftLoadedForRef.current === user.uid) return;
    
    const draftToLoad = await WritingDraftService.loadDraft(user.uid);
    if (draftToLoad) {
      actions.setHasDraft(true);
      // Only auto-load if current content is empty to prevent overwriting active work
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
    }
    draftLoadedForRef.current = user.uid;
  }, [user.uid, actions]);

  const handleSave = async (isLocalOnly: boolean) => {
    const state = useWritingStore.getState();
    
    const sessionData: SessionPayload = {
      userId: user.uid,
      authorName: profile?.nickname || user.displayName || user.email?.split('@')[0] || 'Anonymous',
      authorPhoto: user.photoURL || '',
      nickname: profile?.nickname || '',
      isAnonymous: sessionState.isAnonymous,
      title: state.title,
      content: state.content,
      pinnedThoughts: state.pinnedThoughts,
      duration: state.seconds,
      wordCount: state.wordCount,
      charCount: state.content.length,
      wpm: state.wpm,
      isPublic: sessionState.isPublic,
      tags: sessionState.tags,
      updatedAt: Timestamp.now(),
      sessionType: state.sessionType,
      sessionStartTime: sessionState.sessionStartTime,
      goalReached: state.sessionType === 'timer' ? state.timeGoalReached : (state.sessionType === 'words' ? state.wordGoalReached : true)
    };

    if (isLocalOnly) {
      if (sessionState.encryptionPassword) {
        const dataToEncrypt = JSON.stringify({
          content: sessionData.content,
          title: sessionData.title,
          pinnedThoughts: sessionData.pinnedThoughts
        });
        const { encrypted, salt, iv } = await encrypt(dataToEncrypt, sessionState.encryptionPassword);
        sessionData.content = encrypted;
        sessionData.title = 'Encrypted Session';
        sessionData.pinnedThoughts = [];
        sessionData.encryption = { salt, iv };
        sessionData.isEncrypted = true;
      }

      const sessionKey = `local_session_${Date.now()}_${crypto.randomUUID()}`;
      localStorage.setItem(sessionKey, JSON.stringify(sessionData));
      await WritingDraftService.deleteDraft(user.uid);
      actions.resetSession();
      actions.setStatus('idle');
      return;
    }

    try {
      await WritingSessionService.saveSession(sessionData, sessionState.activeSessionId, isOnline, user.uid);
      await WritingDraftService.deleteDraft(user.uid);
      actions.resetSession();
      actions.setStatus('idle');
    } catch (e) {
      // Error is handled in WritingSessionService
    }
  };

  const handleCancel = async () => {
    await WritingDraftService.deleteDraft(user.uid);
    actions.resetSession();
    actions.setStatus('idle');
  };

  const fetchLocalSessions = useCallback(() => {
    const sessions = [];
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
            duration: data.duration
          });
        } catch (e) {
          sessions.push({ id: key, createdAt: new Date(Number(key.replace('local_session_', ''))) });
        }
      }
    }
    return sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, []);

  const loadLocalSession = useCallback((key: string) => {
    const raw = localStorage.getItem(key);
    try {
      return JSON.parse(raw || '{}');
    } catch (e) {
      console.error('load error:', e);
      return null;
    }
  }, []);

  const decryptSession = useCallback(async (session: any, password: string) => {
    if (!session.isEncrypted || !session.encryption) return session;
    
    try {
      const decryptedStr = await decrypt(
        session.content, 
        password, 
        session.encryption.salt, 
        session.encryption.iv
      );
      const decryptedData = JSON.parse(decryptedStr);
      return {
        ...session,
        content: decryptedData.content,
        title: decryptedData.title,
        pinnedThoughts: decryptedData.pinnedThoughts,
        isEncrypted: false
      };
    } catch (e) {
      throw new Error('Invalid password');
    }
  }, []);

  return {
    saveStatus,
    lastSavedAt,
    isOnline,
    handleSave,
    handleCancel,
    fetchLocalSessions,
    loadLocalSession,
    decryptSession,
    loadDraft
  };
}
