import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { SessionService } from '../services/SessionService';
import { Session, UserProfile } from '../../../types';
import { useWritingSettings } from '../contexts/WritingSettingsContext';

// Components
import { WritingHeader } from '../WritingHeader';
import { WritingSetup, SetupMode } from '../WritingSetup';
import { WritingEditor } from '../WritingEditor';
import { WritingSettings } from '../WritingSettings';
import { WritingFinishModal } from '../WritingFinishModal';
import { ProgressBar } from '../../../shared/components/Layout/ProgressBar';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';

// Modals
import { PasswordPromptModal } from '../components/modals/PasswordPromptModal';
import { CancelConfirmModal } from '../components/modals/CancelConfirmModal';

// Hooks
import { useWritingSession } from '../hooks/useWritingSession';
import { useLanguage } from '../../../core/i18n';

import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';

interface WritingViewProps {
  user: User;
  profile: UserProfile | null;
  sessionToContinue?: Session | null;
  onSessionContinued?: () => void;
}

function WritingPageContent({ user, profile, sessionToContinue, onSessionContinued }: WritingViewProps) {
  const { t, language } = useLanguage();
  const [betaMode] = useLocalStorage('beta-mode', false, z.boolean());
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000); // update every minute
    return () => clearInterval(timer);
  }, []);

  const dateLocale = language === 'ru' ? ru : enUS;
  const dateStr = format(now, 'EEEE, d MMMM', { locale: dateLocale });
  const timeStr = format(now, 'HH:mm');
  
  const { 
    isZenActive, zenModeEnabled, 
    textWidth, 
    setStatus: setUIStatus
  } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const {
    status: sessionStatus, setStatus: setSessionStatus,
    sessionType, setSessionType,
    timerDuration, setTimerDuration,
    wordGoal, setWordGoal,
    targetTime, setTargetTime,
    seconds,
    isPublic, setIsPublic,
    isAnonymous, setIsAnonymous,
    tags, setTags,
    labelId, setLabelId,
    hasDraft,
    saveStatus, lastSavedAt,
    handleStart, handleSave, handleCancel, resetSessionMetadata,
    isOnline,
    fetchLocalSessions,
    loadLocalSession,
    encryptionPassword, setEncryptionPassword,
    decryptSession,
    setActiveSessionId
  } = useWritingSession(user, profile);

  useEffect(() => {
    setUIStatus(sessionStatus);
  }, [sessionStatus, setUIStatus]);

  const [setupMode, setSetupMode] = useState<SetupMode>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{ session: Session, resolve: (p: string) => void, reject: () => void } | null>(null);
  const totalDurationForDeadline = useRef<number | null>(null);

  useEffect(() => {
    if (sessionStatus === 'writing' && sessionType === 'finish-by' && targetTime) {
      if (totalDurationForDeadline.current === null) {
        const [hours, minutes] = targetTime.split(':').map(Number);
        const target = new Date();
        target.setHours(hours, minutes, 0, 0);
        const now = new Date();
        const remaining = Math.max(0, (target.getTime() - now.getTime()) / 1000);
        totalDurationForDeadline.current = remaining + seconds;
      }
    } else if (sessionStatus === 'idle') {
      totalDurationForDeadline.current = null;
    }
  }, [sessionStatus, sessionType, targetTime, seconds]);

  const [userSessions, setUserSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const [isLocalOnly, setIsLocalOnly] = useState(false);

  const countdownRef = useRef<any>(null);

  // Handle session continuation from external source
  useEffect(() => {
    if (sessionToContinue) {
      continueSession(sessionToContinue);
      if (onSessionContinued) onSessionContinued();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        useWritingStore.setState({
          content: loaded.content,
          title: loaded.title || '',
          initialWordCount: loaded.wordCount || 0,
          seconds: loaded.duration || 0,
          wordCount: loaded.wordCount || 0
        });
        setTags(loaded.tags || []);
        setIsPublic(loaded.isPublic);
        setIsAnonymous(loaded.isAnonymous || false);
        setIsLocalOnly(true);
        setSetupMode('selection');
        return;
    }

    setActiveSessionId(session.id);
    useWritingStore.setState({
      content: session.content,
      title: session.title || '',
      initialWordCount: session.wordCount || 0,
      seconds: session.duration || 0,
      wordCount: session.wordCount || 0
    });
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
    
    let count = 3;
    countdownRef.current = setInterval(() => {
      count -= 1;
      setCountdown(count);
      
      if (count === 0) {
        clearInterval(countdownRef.current);
        handleStart();
        setTimeout(() => {
          setSetupMode(null);
          setCountdown(null);
        }, 800);
      }
    }, 1000);
  };

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
      className="w-full transition-colors duration-1000"
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
      <ProgressBar 
        totalDurationForDeadline={totalDurationForDeadline.current}
        isZenActive={isZenActive}
        zenModeEnabled={zenModeEnabled}
      />

      <PasswordPromptModal 
        isOpen={!!passwordPrompt}
        onConfirm={handlePromptSubmit}
        onCancel={handlePromptCancel}
      />

      {showSettings && (
        <WritingSettings 
          showSettings={showSettings}
          setShowSettings={setShowSettings}
        />
      )}

      <CancelConfirmModal 
        isOpen={showCancelConfirm}
        onConfirm={() => {
          handleCancel();
          setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />

      <WritingFinishModal 
        formatTime={formatTime}
        isPublic={isPublic}
        setIsPublic={setIsPublic}
        isAnonymous={isAnonymous}
        setIsAnonymous={setIsAnonymous}
        handleSave={handleSave}
        tags={tags}
        setTags={setTags}
        labelId={labelId}
        setLabelId={setLabelId}
        labels={profile?.labels || []}
        isLocalOnly={isLocalOnly}
      />

      <AdaptiveContainer size={textWidth === 'full' ? 'FULL' : 'CENTERED'}>
        {betaMode && (
          <div className="px-6 pt-8 pb-2">
            <h1 className="text-3xl font-bold text-text-main">
              {dateStr}
            </h1>
            <p className="text-text-main/40 text-lg font-mono mt-1">
              {timeStr}
            </p>
          </div>
        )}

        <WritingHeader 
          formatTime={formatTime}
          handleNewSession={handleNewSession}
          fetchUserSessions={fetchAllSessions}
          loadingSessions={loadingSessions}
          hasDraft={hasDraft}
          setShowSettings={setShowSettings}
          handlePause={() => setSessionStatus('paused')}
          handleStart={handleStart}
          handleFinish={() => setSessionStatus('finished')}
          setShowCancelConfirm={setShowCancelConfirm}
        />

        <div className="relative">
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
            handlePause={() => setSessionStatus('paused')}
            handleStart={handleStart}
            handleFinish={() => setSessionStatus('finished')}
            setShowCancelConfirm={setShowCancelConfirm}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
          />
        </div>
      </AdaptiveContainer>
    </motion.div>
  );
}

export function WritingPage(props: WritingViewProps) {
  return (
    <WritingPageContent {...props} />
  );
}
