import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { SessionService } from '../services/SessionService';
import { Session, UserProfile } from '../../../types';
import { cn } from '../../../core/utils/utils';
import { useUI } from '../../../contexts/UIContext';
import { useWritingSettings } from '../contexts/WritingSettingsContext';

// Components
import { WritingHeader } from '../WritingHeader';
import { WritingSetup, SetupMode } from '../WritingSetup';
import { WritingEditor } from '../WritingEditor';
import { WritingSettings } from '../WritingSettings';
import { SettingsV2 } from '../v2/SettingsV2';
import { WritingFinishModal } from '../WritingFinishModal';

// Modals
import { PasswordPromptModal } from '../components/modals/PasswordPromptModal';
import { CancelConfirmModal } from '../components/modals/CancelConfirmModal';

// Hooks
import { useWritingSession } from '../hooks/useWritingSession';
import { useLanguage } from '../../../core/i18n';

interface WritingViewProps {
  user: User;
  profile: UserProfile | null;
  sessionToContinue?: Session | null;
  onSessionContinued?: () => void;
}

function WritingPageContent({ user, profile, sessionToContinue, onSessionContinued }: WritingViewProps) {
  const { t } = useLanguage();
  const { uiVersion } = useUI();
  const { streamMode, isZenActive, zenModeEnabled, status: uiStatus, setStatus: setUIStatus } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const isV2 = uiVersion === '2.0';
  const {
    status: sessionStatus, setStatus: setSessionStatus,
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
    resetSessionMetadata,
    isOnline,
    fetchLocalSessions,
    loadLocalSession,
    encryptionPassword, setEncryptionPassword,
    decryptSession
  } = useWritingSession(user, profile);

  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{ session: Session, resolve: (p: string) => void, reject: () => void } | null>(null);
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
  const [stickyHeaderEnabled, setStickyHeaderEnabled] = useState(() => {
    const saved = localStorage.getItem('writing_stickyHeaderEnabled');
    return saved === null ? true : saved === 'true';
  });
  // const [dynamicBgEnabled, setDynamicBgEnabled] = useState(() => {
  //   const saved = localStorage.getItem('writing_dynamicBgEnabled');
  //   return saved === null ? true : saved === 'true';
  // });

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
  
  // Persist settings
  useEffect(() => {
    localStorage.setItem('writing_fontSize', fontSize.toString());
    localStorage.setItem('writing_fontFamily', fontFamily);
    localStorage.setItem('writing_textWidth', textWidth);
    localStorage.setItem('writing_stickyHeaderEnabled', stickyHeaderEnabled.toString());
    localStorage.setItem('writing_headerVisibility', JSON.stringify(headerVisibility));
  }, [fontSize, fontFamily, textWidth, stickyHeaderEnabled, headerVisibility]);

  // Sync status with UIContext
  useEffect(() => {
    setUIStatus(sessionStatus);
  }, [sessionStatus, setUIStatus]);

  const countdownRef = useRef<any>(null);

  // Handle session continuation from external source
  useEffect(() => {
    if (sessionToContinue) {
      continueSession(sessionToContinue);
      if (onSessionContinued) onSessionContinued();
    }
  }, [sessionToContinue]);

  const handleNewSession = () => {
    resetSessionMetadata();
    setSetupMode('selection');
  };

  const fetchAllSessions = async () => {
    setLoadingSessions(true);
    try {
      const result = await SessionService.getAllSessions(user.uid, 50);
      const firestoreSessions = result.sessions;
      
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
      console.error('Error fetching sessions:', e);
    } finally {
      setLoadingSessions(false);
    }
  };

  const continueSession = async (session: Session) => {
    console.log('continueSession called', session);
    let sessionToLoad = session;

    if ((session as any).isLocal) {
        let loaded = loadLocalSession(session.id);
        if (!loaded) return;

        if (loaded.isEncrypted) {
          try {
            const password = await new Promise<string>((resolve, reject) => {
              setPasswordPrompt({ session, resolve, reject });
            });
            loaded = await decryptSession(loaded, password);
          } catch (e) {
            console.error('Decryption failed or cancelled');
            return;
          }
        }
        
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

  const handlePromptSubmit = (password: string) => {
    if (passwordPrompt) {
      passwordPrompt.resolve(password);
      setPasswordPrompt(null);
    }
  };

  const handlePromptCancel = () => {
    if (passwordPrompt) {
      passwordPrompt.reject();
      setPasswordPrompt(null);
    }
  };

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
          animate={{ 
            y: showZen ? -20 : 0, 
            opacity: showZen ? 0 : 1 
          }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-amber-500 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2"
        >
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          Работа в офлайн-режиме. Сессия будет сохранена локально.
        </motion.div>
      )}

      {/* Progress Bar */}
      {status === 'writing' && (sessionType === 'words' || sessionType === 'timer' || sessionType === 'finish-by') && (
        <div className={cn(
          "fixed top-0 left-0 w-full h-1 z-[100] transition-all duration-1000", 
          isV2 ? "bg-white/5" : "bg-stone-100 dark:bg-stone-800",
          isZenActive && zenModeEnabled ? "opacity-0 -translate-y-1" : "opacity-100 translate-y-0"
        )}>
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

      <PasswordPromptModal 
        isOpen={!!passwordPrompt}
        isV2={isV2}
        onConfirm={handlePromptSubmit}
        onCancel={handlePromptCancel}
      />

      {isV2 && showSettings ? (
        <SettingsV2 
          onClose={() => setShowSettings(false)}
        />
      ) : !isV2 && showSettings ? (
        <WritingSettings 
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          fontFamily={fontFamily}
          setFontFamily={setFontFamily}
          textWidth={textWidth}
          setTextWidth={setTextWidth}
          fontSize={fontSize}
          setFontSize={setFontSize}
          stickyHeaderEnabled={stickyHeaderEnabled}
          setStickyHeaderEnabled={setStickyHeaderEnabled}
          headerVisibility={headerVisibility}
          setHeaderVisibility={setHeaderVisibility}
        />
      ) : null}

      <CancelConfirmModal 
        isOpen={showCancelConfirm}
        isV2={isV2}
        onConfirm={() => {
          handleCancel();
          setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />

      <WritingFinishModal 
        status={sessionStatus}
        wordCount={wordCount}
        seconds={seconds}
        wpm={wpm}
        formatTime={formatTime}
        isPublic={isPublic}
        setIsPublic={setIsPublic}
        isAnonymous={isAnonymous}
        setIsAnonymous={setIsAnonymous}
        handleSave={handleSave}
        setStatus={setSessionStatus}
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
        status={sessionStatus}
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
        setStatus={setSessionStatus}
        setShowSettings={setShowSettings}
        handlePause={() => setSessionStatus('paused')}
        handleStart={handleStart}
        handleFinish={() => setSessionStatus('finished')}
        setShowCancelConfirm={setShowCancelConfirm}
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
              encryptionPassword={encryptionPassword}
              setEncryptionPassword={setEncryptionPassword}
            />
          )}
        </AnimatePresence>

        <WritingEditor 
          status={sessionStatus}
          title={title}
          setTitle={setTitle}
          pinnedThoughts={pinnedThoughts}
          setPinnedThoughts={setPinnedThoughts}
          content={content}
          setContent={setContent}
          fontSize={fontSize}
          fontFamily={fontFamily}
          textWidth={textWidth}
          handlePause={() => setSessionStatus('paused')}
          handleStart={handleStart}
          handleFinish={() => setSessionStatus('finished')}
          setShowCancelConfirm={setShowCancelConfirm}
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

export function WritingPage(props: WritingViewProps) {
  return (
    <WritingPageContent {...props} />
  );
}
