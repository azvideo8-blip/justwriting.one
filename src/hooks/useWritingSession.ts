import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { collection, addDoc, updateDoc, doc, Timestamp, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { Session } from '../types';
import confetti from 'canvas-confetti';

export function useWritingSession(user: User, profile: any) {
  const [status, setStatus] = useState<'idle' | 'writing' | 'paused' | 'finished'>('idle');
  const [sessionType, setSessionType] = useState<'stopwatch' | 'timer' | 'words'>('stopwatch');
  const [timerDuration, setTimerDuration] = useState(15 * 60);
  const [wordGoal, setWordGoal] = useState(500);
  
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [initialWordCount, setInitialWordCount] = useState(0);
  const [initialDuration, setInitialDuration] = useState(0);
  
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [wpm, setWpm] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [isPublic, setIsPublic] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  
  const [timeGoalReached, setTimeGoalReached] = useState(false);
  const [wordGoalReached, setWordGoalReached] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const timerRef = useRef<any>(null);

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
  }, []);

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

  // Load draft
  useEffect(() => {
    const draft = localStorage.getItem(`draft_${user.uid}`);
    if (draft) {
      setHasDraft(true);
      const data = JSON.parse(draft);
      // Smart sync: check if draft is newer than what we might have in state
      setContent(data.content || '');
      setTitle(data.title || '');
      setSeconds(data.seconds || 0);
      setSessionType(data.sessionType || 'stopwatch');
      setTimerDuration(data.timerDuration || 15 * 60);
      setWordGoal(data.wordGoal || 500);
      if (data.activeSessionId) setActiveSessionId(data.activeSessionId);
    }
  }, [user.uid]);

  // Autosave
  useEffect(() => {
    if (status === 'writing' || status === 'paused') {
      localStorage.setItem(`draft_${user.uid}`, JSON.stringify({
        content,
        title,
        seconds,
        sessionType,
        timerDuration,
        wordGoal,
        activeSessionId,
        updatedAt: new Date().toISOString()
      }));
    }
  }, [content, title, seconds, status, user.uid, sessionType, timerDuration, wordGoal, activeSessionId]);

  // Timer logic
  useEffect(() => {
    if (status === 'writing') {
      timerRef.current = setInterval(() => {
        setSeconds(s => {
          const next = s + 1;
          if (sessionType === 'timer' && next >= timerDuration) {
            setTimeGoalReached(true);
          }
          return next;
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [status, sessionType, timerDuration]);

  // Stats logic
  useEffect(() => {
    const words = content.trim().split(/\s+/).filter(x => x.length > 3).length;
    setWordCount(words);
    if (seconds > 0) {
      const sessionWords = Math.max(0, words - initialWordCount);
      setWpm(Math.round((sessionWords / seconds) * 60));
    }
    if (sessionType === 'words' && (words - initialWordCount) >= wordGoal) {
      setWordGoalReached(true);
    }
  }, [content, seconds, sessionType, wordGoal, initialWordCount]);

  // Confetti
  useEffect(() => {
    if (wordGoalReached) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#141414', '#ffffff', '#4ade80']
      });
    }
  }, [wordGoalReached]);

  const handleStart = () => {
    setStatus('writing');
    setTimeGoalReached(false);
    setWordGoalReached(false);
  };

  const handleSave = async () => {
    const currentWordCount = content.trim().split(/\s+/).filter(x => x.length > 3).length;
    const sessionData = {
      userId: user.uid,
      authorName: user.displayName || 'Anonymous',
      authorPhoto: user.photoURL || '',
      nickname: profile?.nickname || '',
      isAnonymous,
      title,
      content,
      duration: initialDuration + seconds,
      wordCount: currentWordCount,
      charCount: content.length,
      wpm,
      isPublic,
      tags,
      updatedAt: Timestamp.now(),
      sessionType,
      goalReached: sessionType === 'timer' ? timeGoalReached : (sessionType === 'words' ? wordGoalReached : true)
    };

    if (!isOnline) {
      const pending = JSON.parse(localStorage.getItem(`pending_sessions_${user.uid}`) || '[]');
      pending.push({ id: activeSessionId, data: sessionData });
      localStorage.setItem(`pending_sessions_${user.uid}`, JSON.stringify(pending));
      localStorage.removeItem(`draft_${user.uid}`);
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
      
      localStorage.removeItem(`draft_${user.uid}`);
      resetSession();
      setStatus('idle');
    } catch (e) {
      handleFirestoreError(e, activeSessionId ? OperationType.UPDATE : OperationType.CREATE, 'sessions');
    }
  };

  const resetSession = () => {
    setContent('');
    setTitle('');
    setSeconds(0);
    setInitialWordCount(0);
    setInitialDuration(0);
    setActiveSessionId(null);
    setTags([]);
    setIsPublic(false);
    setIsAnonymous(false);
    setHasDraft(false);
  };

  const handleCancel = () => {
    localStorage.removeItem(`draft_${user.uid}`);
    resetSession();
    setStatus('idle');
  };

  return {
    status, setStatus,
    sessionType, setSessionType,
    timerDuration, setTimerDuration,
    wordGoal, setWordGoal,
    content, setContent,
    title, setTitle,
    seconds, setSeconds,
    wpm, wordCount,
    isPublic, setIsPublic,
    isAnonymous, setIsAnonymous,
    tags, setTags,
    timeGoalReached, wordGoalReached,
    hasDraft, setHasDraft,
    initialWordCount, setInitialWordCount,
    initialDuration, setInitialDuration,
    activeSessionId, setActiveSessionId,
    handleStart, handleSave, handleCancel, resetSession
  };
}
