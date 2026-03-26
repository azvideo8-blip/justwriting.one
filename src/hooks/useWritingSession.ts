import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { collection, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { deleteDraft, getDraft } from '../lib/db';
import { useTimer } from './useTimer';
import { useWritingStats } from './useWritingStats';
import { useDraftAutosave } from './useDraftAutosave';

export function useWritingSession(user: User, profile: any) {
  const [sessionType, setSessionType] = useState<'stopwatch' | 'timer' | 'words' | 'finish-by'>('stopwatch');
  const [timerDuration, setTimerDuration] = useState(15 * 60);
  const [wordGoal, setWordGoal] = useState(500);
  const [targetTime, setTargetTime] = useState<string | null>(null);
  
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [initialWordCount, setInitialWordCount] = useState(0);
  const [initialDuration, setInitialDuration] = useState(0);
  
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [pinnedThoughts, setPinnedThoughts] = useState<string[]>([]);
  
  const [isPublic, setIsPublic] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [labelId, setLabelId] = useState<string | undefined>(undefined);
  
  const [hasDraft, setHasDraft] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const { seconds, status, setStatus, timeGoalReached, setTimeGoalReached, resetTimer } = useTimer(sessionType, timerDuration, targetTime);
  const { wordCount, wpm, wordGoalReached, setWordGoalReached, resetStats } = useWritingStats(content, seconds, initialWordCount, sessionType, wordGoal);
  const { saveStatus, lastSavedAt } = useDraftAutosave(user, { title, content, pinnedThoughts, seconds, wpm, wordCount, activeSessionId, status });

  // Online status listener
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      syncPendingSessions();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user.uid]);

  const syncPendingSessions = async () => {
    const pending = localStorage.getItem(`pending_sessions_${user.uid}`);
    if (!pending) return;

    const sessions = JSON.parse(pending);
    const remaining = [];

    for (const session of sessions) {
      try {
        if (session.id) {
          await updateDoc(doc(db, 'sessions', session.id), {
            ...session.data,
            updatedAt: Timestamp.now()
          });
        } else {
          await addDoc(collection(db, 'sessions'), {
            ...session.data,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });
        }
      } catch (e) {
        remaining.push(session);
      }
    }

    if (remaining.length > 0) {
      localStorage.setItem(`pending_sessions_${user.uid}`, JSON.stringify(remaining));
    } else {
      localStorage.removeItem(`pending_sessions_${user.uid}`);
    }
  };

  // Load draft from IndexedDB
  useEffect(() => {
    if (user) {
      getDraft(user.uid).then(draft => {
        if (draft) {
          setHasDraft(true);
          setContent(draft.content || '');
          setTitle(draft.title || '');
          setPinnedThoughts(draft.pinnedThoughts || []);
          // Note: timer/stats state needs to be restored here or in the hooks
          if (draft.activeSessionId) setActiveSessionId(draft.activeSessionId);
        }
      });
    }
  }, [user.uid]);

  const handleStart = () => {
    setStatus('writing');
    setTimeGoalReached(false);
    setWordGoalReached(false);
  };

  const handleSave = async (isLocalOnly: boolean) => {
    let sessionData: any = {
      userId: user.uid,
      authorName: user.displayName || 'Anonymous',
      authorPhoto: user.photoURL || '',
      nickname: profile?.nickname || '',
      isAnonymous,
      title,
      content,
      pinnedThoughts,
      duration: initialDuration + seconds,
      wordCount: wordCount,
      charCount: content.length,
      wpm,
      isPublic,
      tags,
      updatedAt: Timestamp.now(),
      sessionType,
      goalReached: sessionType === 'timer' ? timeGoalReached : (sessionType === 'words' ? wordGoalReached : true)
    };

    if (isLocalOnly) {
      localStorage.setItem(`local_session_${Date.now()}`, JSON.stringify(sessionData));
      await deleteDraft(user.uid);
      resetSession();
      setStatus('idle');
      return;
    }

    if (!isOnline) {
      const pending = JSON.parse(localStorage.getItem(`pending_sessions_${user.uid}`) || '[]');
      pending.push({ id: activeSessionId, data: sessionData });
      localStorage.setItem(`pending_sessions_${user.uid}`, JSON.stringify(pending));
      await deleteDraft(user.uid);
      resetSession();
      setStatus('idle');
      return;
    }

    try {
      if (activeSessionId) {
        await updateDoc(doc(db, 'sessions', activeSessionId), sessionData);
      } else {
        await addDoc(collection(db, 'sessions'), {
          ...sessionData,
          createdAt: Timestamp.now(),
        });
      }
      
      await deleteDraft(user.uid);
      resetSession();
      setStatus('idle');
    } catch (e) {
      handleFirestoreError(e, activeSessionId ? OperationType.UPDATE : OperationType.CREATE, 'sessions');
    }
  };

  const resetSession = () => {
    setContent('');
    setTitle('');
    setPinnedThoughts([]);
    resetTimer();
    resetStats();
    setInitialWordCount(0);
    setInitialDuration(0);
    setActiveSessionId(null);
    setTags([]);
    setIsPublic(false);
    setIsAnonymous(false);
    setHasDraft(false);
    setLabelId(undefined);
  };

  const handleCancel = async () => {
    await deleteDraft(user.uid);
    resetSession();
    setStatus('idle');
  };

  const fetchLocalSessions = () => {
    const sessions = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('local_session_')) {
        sessions.push({ id: key, createdAt: new Date(Number(key.replace('local_session_', ''))) });
      }
    }
    return sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  };

  const loadLocalSession = (key: string) => {
    const raw = localStorage.getItem(key);
    try {
      return JSON.parse(raw || '{}');
    } catch (e) {
      console.error('load error:', e);
      return null;
    }
  };

  return {
    status, setStatus,
    sessionType, setSessionType,
    timerDuration, setTimerDuration,
    wordGoal, setWordGoal,
    targetTime, setTargetTime,
    content, setContent,
    title, setTitle,
    pinnedThoughts, setPinnedThoughts,
    seconds,
    wpm, wordCount,
    isPublic, setIsPublic,
    isAnonymous, setIsAnonymous,
    tags, setTags,
    labelId, setLabelId,
    timeGoalReached, wordGoalReached,
    hasDraft, setHasDraft,
    initialWordCount, setInitialWordCount,
    initialDuration, setInitialDuration,
    activeSessionId, setActiveSessionId,
    saveStatus, lastSavedAt,
    handleStart, handleSave, handleCancel, resetSession,
    isOnline,
    fetchLocalSessions,
    loadLocalSession
  };
}
