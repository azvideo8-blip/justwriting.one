import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { User } from 'firebase/auth';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { Session } from '../types';
import { cn } from '../lib/utils';
import { useUI } from '../contexts/UIContext';

// Components
import { WritingHeader } from '../components/writing/WritingHeader';
import { WritingSetup, SetupMode } from '../components/writing/WritingSetup';
import { WritingEditor } from '../components/writing/WritingEditor';
import { WritingSettings } from '../components/writing/WritingSettings';
import { WritingFinishModal } from '../components/writing/WritingFinishModal';

// Hooks
import { useWritingSession } from '../hooks/useWritingSession';
import { useLanguage } from '../lib/i18n';

interface WritingViewProps {
  user: User;
  profile: any;
  sessionToContinue?: Session | null;
  onSessionContinued?: () => void;
}

export function WritingView({ user, profile, sessionToContinue, onSessionContinued }: WritingViewProps) {
  const { t } = useLanguage();
  const { uiVersion, streamMode } = useUI();
  const isV2 = uiVersion === '2.0';
  const {
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
    // highlights, setHighlights,
    handleStart, handleSave, handleCancel, resetSession,
    isOnline,
    fetchLocalSessions,
    loadLocalSession
  } = useWritingSession(user, profile);

  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const totalDurationForDeadline = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'writing' && sessionType === 'finish-by' && targetTime) {
      if (totalDurationForDeadline.current === null) {
        const [hours, minutes] = targetTime.split(':').map(Number);
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        const now = new Date();
        const remaining = Math.max(0, (target.getTime() - now.getTime()) / 1000);
        totalDurationForDeadline.current = remaining + seconds;
      }
    } else if (status === 'idle') {
      totalDurationForDeadline.current = null;
    }
  }, [status, sessionType, targetTime, seconds]);

  const [userSessions, setUserSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tagInput, setTagInput] = useState('');
  
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem('writing_fontSize')) || 23);
  const [fontFamily, setFontFamily] = useState(() => localStorage.getItem('writing_fontFamily') || 'Inter');
  const [textWidth, setTextWidth] = useState<'centered' | 'full'>(() => (localStorage.getItem('writing_textWidth') as any) || 'full');
  const [zenModeEnabled, setZenModeEnabled] = useState(() => {
    const saved = localStorage.getItem('writing_zenModeEnabled');
    return saved === null ? true : saved === 'true';
  });
  // const [dynamicBgEnabled, setDynamicBgEnabled] = useState(() => {
  //   const saved = localStorage.getItem('writing_dynamicBgEnabled');
  //   return saved === null ? true : saved === 'true';
  // });
  const [stickyHeaderEnabled, setStickyHeaderEnabled] = useState(() => {
    const saved = localStorage.getItem('writing_stickyHeaderEnabled');
    return saved === null ? true : saved === 'true';
  });

  const [isLocalOnly, setIsLocalOnly] = useState(false);

  const [headerVisibility, setHeaderVisibility] = useState(() => {
    const saved = localStorage.getItem('writing_headerVisibility');
    return saved ? JSON.parse(saved) : {
      currentTime: true,
      sessionTime: true,
      sessionWords: true,
      totalWords: true,
      wpm: true
    };
  });
  
  const [isZenActive, setIsZenActive] = useState(false);
  const zenTimerRef = useRef<any>(null);

  // Persist settings
  useEffect(() => {
    localStorage.setItem('writing_fontSize', fontSize.toString());
    localStorage.setItem('writing_fontFamily', fontFamily);
    localStorage.setItem('writing_textWidth', textWidth);
    localStorage.setItem('writing_zenModeEnabled', zenModeEnabled.toString());
    // localStorage.setItem('writing_dynamicBgEnabled', dynamicBgEnabled.toString());
    localStorage.setItem('writing_stickyHeaderEnabled', stickyHeaderEnabled.toString());
    localStorage.setItem('writing_headerVisibility', JSON.stringify(headerVisibility));
  }, [fontSize, fontFamily, textWidth, zenModeEnabled, /* dynamicBgEnabled, */ stickyHeaderEnabled, headerVisibility]);

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
      }, 5000); // Increased to 5s
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

  const fetchAllSessions = async () => {
    setLoadingSessions(true);
    try {
      const q = query(
        collection(db, 'sessions'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const firestoreSessions = snap.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      
      const localSessions = fetchLocalSessions().map(s => {
        const data = loadLocalSession(s.id);
        return {
          ...s,
          title: data?.title || t('writing_local_session'),
          content: data?.content || '',
          wordCount: data?.wordCount || 0,
          duration: data?.duration || 0,
          isLocal: true
        };
      });

      setUserSessions([...firestoreSessions, ...localSessions] as Session[]);
      setSetupMode('session-selection');
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, 'sessions');
    } finally {
      setLoadingSessions(false);
    }
  };

  const continueSession = async (session: Session) => {
    console.log('continueSession called', session);
    if ((session as any).isLocal) {
        const loaded = loadLocalSession(session.id);
        if (!loaded) return;
        
        setActiveSessionId(null);
        setContent(loaded.content);
        setTitle(loaded.title || '');
        setInitialWordCount(loaded.wordCount || 0);
        setInitialDuration(loaded.duration || 0);
        setTags(loaded.tags || []);
        setIsPublic(loaded.isPublic);
        setIsAnonymous(loaded.isAnonymous || false);
        setIsLocalOnly(true);
        setSetupMode('selection');
        return;
    }

    setActiveSessionId(session.id);
    setContent(session.content);
    setTitle(session.title || '');
    setInitialWordCount(session.wordCount || 0);
    setInitialDuration(session.duration || 0);
    setTags(session.tags || []);
    setIsPublic(session.isPublic);
    setIsAnonymous(session.isAnonymous || false);
    setIsLocalOnly(false);
    setSetupMode('selection');
  };

  const startCountdown = (type: 'stopwatch' | 'timer' | 'words' | 'finish-by') => {
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

  // const getDynamicBgStyle = () => {
  //   if (!dynamicBgEnabled || status !== 'writing') return {};
  //   
  //   // Reach max intensity at 20 WPM
  //   const intensity = Math.min(wpm / 20, 1); 
  //   const hue = 30; // Warm amber
  //   const saturation = intensity * 60; 
  //   
  //   // Light mode: from 100% lightness to ~80%
  //   const lightness = 100 - (intensity * 20);
  //   // Dark mode: from 12% lightness to ~30%
  //   const darkLightness = 12 + (intensity * 18);
  //   
  //   return {
  //     '--dynamic-bg': `hsl(${hue}, ${saturation}%, ${lightness}%)`,
  //     '--dynamic-bg-dark': `hsl(${hue}, ${saturation}%, ${darkLightness}%)`,
  //     backgroundColor: 'var(--dynamic-bg)',
  //   } as React.CSSProperties;
  // };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        "w-full transition-colors duration-1000",
        // dynamicBgEnabled && status === 'writing' && "dark:!bg-[var(--dynamic-bg-dark)]"
      )}
      // style={getDynamicBgStyle()}
    >
      {/* Offline Notification */}
      {!isOnline && (
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-amber-500 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2"
        >
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          Работа в офлайн-режиме. Сессия будет сохранена локально.
        </motion.div>
      )}

      {/* Progress Bar */}
      {status === 'writing' && (sessionType === 'words' || sessionType === 'timer' || sessionType === 'finish-by') && (
        <div className={cn("fixed top-0 left-0 w-full h-1 z-[100]", isV2 ? "bg-white/5" : "bg-stone-100 dark:bg-stone-800")}>
          <motion.div 
            initial={{ width: 0 }}
            animate={{ 
              width: sessionType === 'words' 
                ? `${Math.min((wordCount / wordGoal) * 100, 100)}%`
                : `${Math.min(((sessionType === 'timer' ? seconds / timerDuration : seconds / (totalDurationForDeadline.current || 1)) * 100), 100)}%`
            }}
            className={cn(
              "h-full transition-colors duration-500",
              (wordGoalReached || timeGoalReached) ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : (isV2 ? "bg-white/50" : "bg-stone-900 dark:bg-stone-100")
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
        // dynamicBgEnabled={dynamicBgEnabled}
        // setDynamicBgEnabled={setDynamicBgEnabled}
        stickyHeaderEnabled={stickyHeaderEnabled}
        setStickyHeaderEnabled={setStickyHeaderEnabled}
        headerVisibility={headerVisibility}
        setHeaderVisibility={setHeaderVisibility}
      />

      {showCancelConfirm && (
        <div className={cn("fixed inset-0 z-[60] flex items-center justify-center p-4", isV2 ? "bg-[#0A0A0B]/80 backdrop-blur-2xl" : "bg-stone-900/60 backdrop-blur-md")}>
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn("w-full max-w-sm rounded-3xl p-8 shadow-2xl space-y-6 text-center border", isV2 ? "bg-[#0A0A0B]/90 backdrop-blur-2xl border-white/10 shadow-[0_0_40px_rgba(255,255,255,0.05)]" : "bg-white dark:bg-stone-900 border-transparent")}
          >
            <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mx-auto", isV2 ? "bg-red-500/10 text-red-500" : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400")}>
              <X size={32} />
            </div>
            <div className="space-y-2">
              <h3 className={cn("text-xl font-bold", isV2 ? "text-white" : "dark:text-stone-100")}>{t('writing_cancel_confirm')}</h3>
              <p className={cn("text-sm", isV2 ? "text-white/50" : "text-stone-500 dark:text-stone-400")}>{t('writing_cancel_desc')}</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowCancelConfirm(false)}
                className={cn("flex-1 px-4 py-3 rounded-xl font-bold transition-all border", isV2 ? "border-white/10 text-white hover:bg-white/5" : "border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800")}
              >
                {t('writing_back')}
              </button>
              <button 
                onClick={() => {
                  handleCancel();
                  setShowCancelConfirm(false);
                }}
                className={cn("flex-1 px-4 py-3 rounded-xl font-bold transition-all", isV2 ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "bg-red-600 text-white hover:bg-red-700")}
              >
                {t('finish_discard')}
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
        tags={tags}
        setTags={setTags}
        labelId={labelId}
        setLabelId={setLabelId}
        labels={profile?.labels || []}
        isLocalOnly={isLocalOnly}
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
        targetTime={targetTime}
        wpm={wpm}
        formatTime={formatTime}
        handleNewSession={handleNewSession}
        fetchUserSessions={fetchAllSessions}
        loadingSessions={loadingSessions}
        hasDraft={hasDraft}
        setStatus={setStatus}
        setShowSettings={setShowSettings}
        handlePause={() => setStatus('paused')}
        handleStart={handleStart}
        handleFinish={() => setStatus('finished')}
        setShowCancelConfirm={setShowCancelConfirm}
        isZenActive={isZenActive}
        stickyHeaderEnabled={stickyHeaderEnabled}
        headerVisibility={headerVisibility}
        streamMode={streamMode}
      />

      <div className="relative min-h-[600px]">
        <AnimatePresence>
          {setupMode && (
            <WritingSetup 
              setupMode={setupMode}
              setSetupMode={setSetupMode}
              startCountdown={startCountdown}
              timerDuration={timerDuration}
              setTimerDuration={setTimerDuration}
              wordGoal={wordGoal}
              setWordGoal={setWordGoal}
              targetTime={targetTime}
              setTargetTime={setTargetTime}
              countdown={countdown}
              userSessions={userSessions}
              continueSession={continueSession}
              formatTime={formatTime}
              isLocalOnly={isLocalOnly}
              setIsLocalOnly={setIsLocalOnly}
            />
          )}
        </AnimatePresence>

        <WritingEditor 
          status={status}
          title={title}
          setTitle={setTitle}
          pinnedThoughts={pinnedThoughts}
          setPinnedThoughts={setPinnedThoughts}
          content={content}
          setContent={setContent}
          fontSize={fontSize}
          fontFamily={fontFamily}
          textWidth={textWidth}
          handlePause={() => setStatus('paused')}
          handleStart={handleStart}
          handleFinish={() => setStatus('finished')}
          setShowCancelConfirm={setShowCancelConfirm}
          isZenActive={isZenActive}
          // dynamicBgEnabled={dynamicBgEnabled}
          wpm={wpm}
          saveStatus={saveStatus}
          lastSavedAt={lastSavedAt}
          stickyHeaderEnabled={stickyHeaderEnabled}
          streamMode={streamMode}
          // highlights={highlights}
          // setHighlights={setHighlights}
        />
      </div>
    </motion.div>
  );
}
