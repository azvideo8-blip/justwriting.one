import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { WritingSessionService } from '../services/WritingSessionService';
import { WritingDraftService } from '../services/WritingDraftService';
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

  // Load draft from IndexedDB and Firestore
  useEffect(() => {
    if (user) {
      WritingDraftService.loadDraft(user.uid).then((draftToLoad) => {
        if (draftToLoad) {
          setHasDraft(true);
          setContent(draftToLoad.content || '');
          setTitle(draftToLoad.title || '');
          setPinnedThoughts(draftToLoad.pinnedThoughts || []);
          if (draftToLoad.activeSessionId) setActiveSessionId(draftToLoad.activeSessionId);
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
      await WritingDraftService.deleteDraft(user.uid);
      resetSession();
      setStatus('idle');
      return;
    }

    if (!isOnline) {
      const pending = JSON.parse(localStorage.getItem(`pending_sessions_${user.uid}`) || '[]');
      pending.push({ id: activeSessionId, data: sessionData });
      localStorage.setItem(`pending_sessions_${user.uid}`, JSON.stringify(pending));
      await WritingDraftService.deleteDraft(user.uid);
      resetSession();
      setStatus('idle');
      return;
    }

    try {
      await WritingSessionService.saveSession(sessionData, activeSessionId);
      await WritingDraftService.deleteDraft(user.uid);
      resetSession();
      setStatus('idle');
    } catch (e) {
      // Error is handled in WritingSessionService
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
    await WritingDraftService.deleteDraft(user.uid);
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
