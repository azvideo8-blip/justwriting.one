import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { User } from 'firebase/auth';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { Session } from '../types';
import { cn } from '../lib/utils';

// Components
import { WritingHeader } from '../components/writing/WritingHeader';
import { WritingSetup } from '../components/writing/WritingSetup';
import { WritingEditor } from '../components/writing/WritingEditor';
import { WritingSettings } from '../components/writing/WritingSettings';
import { WritingFinishModal } from '../components/writing/WritingFinishModal';

// Hooks
import { useWritingSession } from '../hooks/useWritingSession';

interface WritingViewProps {
  user: User;
  profile: any;
  sessionToContinue?: Session | null;
  onSessionContinued?: () => void;
}

export function WritingView({ user, profile, sessionToContinue, onSessionContinued }: WritingViewProps) {
  const {
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
  } = useWritingSession(user, profile);

  const [setupMode, setSetupMode] = useState<'selection' | 'timer-config' | 'words-config' | 'countdown' | 'session-selection' | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [userSessions, setUserSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tagInput, setTagInput] = useState('');
  
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('writing_fontSize')) || 20);
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('writing_fontFamily') || 'Inter');
  const [textWidth, setTextWidth] = useState<'centered' | 'full'>(() => (localStorage.getItem('writing_textWidth') as any) || 'full');
  const [zenModeEnabled, setZenModeEnabled] = useState(() => localStorage.getItem('writing_zenModeEnabled') === 'true');
  const [dynamicBgEnabled, setDynamicBgEnabled] = useState(() => localStorage.getItem('writing_dynamicBgEnabled') === 'true');
  const [flowIndicatorEnabled, setFlowIndicatorEnabled] = useState(() => localStorage.getItem('writing_flowIndicatorEnabled') === 'true');
  
  const [isZenActive, setIsZenActive] = useState(false);
  const zenTimerRef = useRef<any>(null);

  // Persist settings
  useEffect(() => {
    localStorage.setItem('writing_fontSize', fontSize.toString());
    localStorage.setItem('writing_fontFamily', fontFamily);
    localStorage.setItem('writing_textWidth', textWidth);
    localStorage.setItem('writing_zenModeEnabled', zenModeEnabled.toString());
    localStorage.setItem('writing_dynamicBgEnabled', dynamicBgEnabled.toString());
    localStorage.setItem('writing_flowIndicatorEnabled', flowIndicatorEnabled.toString());
  }, [fontSize, fontFamily, textWidth, zenModeEnabled, dynamicBgEnabled, flowIndicatorEnabled]);

  // Zen Mode Logic
  useEffect(() => {
    if (status !== 'writing' || !zenModeEnabled) {
      setIsZenActive(false);
      return;
    }

    const handleActivity = () => {
      setIsZenActive(true);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
      zenTimerRef.current = setTimeout(() => {
        setIsZenActive(false);
      }, 3000);
    };

    window.addEventListener('keydown', handleActivity);
    return () => {
      window.removeEventListener('keydown', handleActivity);
      if (zenTimerRef.current) clearTimeout(zenTimerRef.current);
    };
  }, [status, zenModeEnabled]);

  const countdownRef = useRef<any>(null);

  // Handle session continuation from external source
  useEffect(() => {
    if (sessionToContinue) {
      continueSession(sessionToContinue);
      if (onSessionContinued) onSessionContinued();
    }
  }, [sessionToContinue]);

  const handleNewSession = () => {
    resetSession();
    setSetupMode('selection');
  };

  const fetchUserSessions = async () => {
    setLoadingSessions(true);
    try {
      const q = query(
        collection(db, 'sessions'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const sessions = snap.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      setUserSessions(sessions);
      setSetupMode('session-selection');
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'sessions');
    } finally {
      setLoadingSessions(false);
    }
  };

  const continueSession = (session: Session) => {
    setActiveSessionId(session.id);
    setContent(session.content);
    setTitle(session.title || '');
    setInitialWordCount(session.wordCount || 0);
    setInitialDuration(session.duration || 0);
    setTags(session.tags || []);
    setIsPublic(session.isPublic);
    setIsAnonymous(session.isAnonymous || false);
    setSetupMode('selection');
  };

  const startCountdown = (type: 'stopwatch' | 'timer' | 'words') => {
    setSessionType(type);
    setSetupMode('countdown');
    setCountdown(3);
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c === 1) {
          clearInterval(countdownRef.current);
          handleStart();
          setTimeout(() => {
            setSetupMode(null);
            setCountdown(null);
          }, 800);
          return 0;
        }
        return c ? c - 1 : 0;
      });
    }, 1000);
  };

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (t: string) => {
    setTags(tags.filter(tag => tag !== t));
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full space-y-8 pb-20"
    >
      {/* Progress Bar */}
      {status !== 'idle' && sessionType === 'words' && (
        <div className="fixed top-0 left-0 w-full h-1 z-[100] bg-stone-100 dark:bg-stone-800">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min((wordCount / wordGoal) * 100, 100)}%` }}
            className={cn(
              "h-full transition-colors duration-500",
              wordGoalReached ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-stone-900 dark:bg-stone-100"
            )}
          />
        </div>
      )}

      <WritingSettings 
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        fontFamily={fontFamily}
        setFontFamily={setFontFamily}
        textWidth={textWidth}
        setTextWidth={setTextWidth}
        fontSize={fontSize}
        setFontSize={setFontSize}
        zenModeEnabled={zenModeEnabled}
        setZenModeEnabled={setZenModeEnabled}
        dynamicBgEnabled={dynamicBgEnabled}
        setDynamicBgEnabled={setDynamicBgEnabled}
        flowIndicatorEnabled={flowIndicatorEnabled}
        setFlowIndicatorEnabled={setFlowIndicatorEnabled}
      />

      {showCancelConfirm && (
        <div className="fixed inset-0 z-[60] bg-stone-900/60 backdrop-blur-md flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-stone-900 w-full max-w-sm rounded-3xl p-8 shadow-2xl space-y-6 text-center"
          >
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
              <X size={32} />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold dark:text-stone-100">Отменить сессию?</h3>
              <p className="text-stone-500 dark:text-stone-400 text-sm">Весь несохраненный прогресс будет безвозвратно удален.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 px-4 py-3 border border-stone-200 dark:border-stone-800 rounded-xl font-bold hover:bg-stone-50 dark:hover:bg-stone-800 transition-all"
              >
                Назад
              </button>
              <button 
                onClick={() => {
                  handleCancel();
                  setShowCancelConfirm(false);
                }}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all"
              >
                Удалить
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <WritingFinishModal 
        status={status}
        wordCount={wordCount}
        seconds={seconds}
        wpm={wpm}
        formatTime={formatTime}
        isPublic={isPublic}
        setIsPublic={setIsPublic}
        isAnonymous={isAnonymous}
        setIsAnonymous={setIsAnonymous}
        handleSave={handleSave}
        setStatus={setStatus}
        content={content}
        title={title}
      />

      <WritingHeader 
        status={status}
        sessionType={sessionType}
        timeGoalReached={timeGoalReached}
        wordGoalReached={wordGoalReached}
        seconds={seconds}
        wordCount={wordCount}
        initialWordCount={initialWordCount}
        wordGoal={wordGoal}
        wpm={wpm}
        formatTime={formatTime}
        handleNewSession={handleNewSession}
        fetchUserSessions={fetchUserSessions}
        loadingSessions={loadingSessions}
        hasDraft={hasDraft}
        setStatus={setStatus}
        setShowSettings={setShowSettings}
        isZenActive={isZenActive}
      />

      <div className="relative group">
        <WritingSetup 
          setupMode={setupMode}
          setSetupMode={setSetupMode}
          startCountdown={startCountdown}
          timerDuration={timerDuration}
          setTimerDuration={setTimerDuration}
          wordGoal={wordGoal}
          setWordGoal={setWordGoal}
          countdown={countdown}
          userSessions={userSessions}
          continueSession={continueSession}
          formatTime={formatTime}
        />

        <WritingEditor 
          status={status}
          title={title}
          setTitle={setTitle}
          content={content}
          setContent={setContent}
          fontSize={fontSize}
          fontFamily={fontFamily}
          textWidth={textWidth}
          handlePause={() => setStatus('paused')}
          handleStart={handleStart}
          handleFinish={() => setStatus('finished')}
          setShowCancelConfirm={setShowCancelConfirm}
          tags={tags}
          tagInput={tagInput}
          setTagInput={setTagInput}
          addTag={addTag}
          removeTag={removeTag}
          isZenActive={isZenActive}
          dynamicBgEnabled={dynamicBgEnabled}
          flowIndicatorEnabled={flowIndicatorEnabled}
          wpm={wpm}
        />
      </div>
    </motion.div>
  );
}
