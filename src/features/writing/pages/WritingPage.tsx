import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { Session, UserProfile } from '../../../types';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useSettings } from '../../../core/settings/SettingsContext';
import { GoalToast } from '../../../shared/components/GoalToast';
import { useLocation, useNavigate } from 'react-router-dom';

// Components
import { WritingHeader } from '../WritingHeader';
import { WritingSetup } from '../WritingSetup';
import { WritingEditor } from '../WritingEditor';
import { WritingFinishModal } from '../WritingFinishModal';
import { AdaptiveContainer } from '../../../shared/components/Layout/AdaptiveContainer';

// Modals
import { PasswordPromptModal } from '../components/modals/PasswordPromptModal';
import { CancelConfirmModal } from '../components/modals/CancelConfirmModal';

// Hooks
import { useWritingSession } from '../hooks/useWritingSession';
import { useSessionList } from '../hooks/useSessionList';
import { useSessionContinue } from '../hooks/useSessionContinue';
import { useSessionFlow } from '../hooks/useSessionFlow';
import { useLanguage } from '../../../core/i18n';
import { ConnectionStatusBanner } from '../components/ConnectionStatusBanner';

import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';

interface WritingViewProps {
  user: User;
  profile: UserProfile | null;
}

function WritingPageContent({ user, profile }: WritingViewProps) {
  const { t } = useLanguage();
  const [classicNav] = useLocalStorage('classic-nav', false, z.boolean());
  const location = useLocation();
  const navigate = useNavigate();
  const sessionToContinue = (location.state as { sessionToContinue?: Session | null } | null)?.sessionToContinue || null;

  const timeGoalReached = useWritingStore(s => s.timeGoalReached);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);

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

  const flow = useSessionFlow(
    handleStart, sessionStatus, sessionType, setSessionType,
    targetTime, seconds, timeGoalReached, wordGoalReached
  );

  const [isLocalOnly, setIsLocalOnly] = useState(false);
  const { openSettings } = useSettings();

  const { continueSession, passwordPrompt, handlePromptSubmit, handlePromptCancel } = useSessionContinue({
    setSetupMode: flow.setSetupMode,
    setIsLocalOnly,
    setActiveSessionId,
    setTags,
    setIsPublic,
    setIsAnonymous,
    loadLocalSession,
    decryptSession
  });

  const [firstVisit, setFirstVisit] = useLocalStorage('first-visit', true, z.boolean());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+P (Mac) or Ctrl+P (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        // Only during active session
        if (sessionStatus === 'writing' || sessionStatus === 'paused') {
          e.preventDefault(); // block browser print dialog
          
          if (sessionStatus === 'writing') {
            setSessionStatus('paused');
          } else if (sessionStatus === 'paused') {
            handleStart();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionStatus, handleStart, setSessionStatus]);

  const { userSessions, loadingSessions, fetchAllSessions: fetchSessions } = useSessionList(
    user.uid,
    fetchLocalSessions,
    loadLocalSession
  );

  // Handle session continuation from external source
  useEffect(() => {
    if (sessionToContinue) {
      continueSession(sessionToContinue);
      // Очистить state
      navigate(location.pathname, { state: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToContinue]);

  const handleNewSession = () => {
    resetSessionMetadata();
    flow.setSetupMode('selection');
  };

  const fetchAllSessions = async () => {
    await fetchSessions();
    flow.setSetupMode('session-selection');
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full transition-colors duration-1000"
    >
      <ConnectionStatusBanner isOnline={isOnline} showZen={showZen} />

      {/* Progress Bar */}
      {/* ProgressBar removed, now inline in WritingHeader */}

      <GoalToast visible={flow.goalToastVisible} type={flow.goalToastType} />

      <AnimatePresence>
        {flow.sessionStartFlash && (
          <motion.div
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="fixed inset-0 z-[200] bg-text-main pointer-events-none"
          />
        )}
      </AnimatePresence>

      <PasswordPromptModal 
        isOpen={!!passwordPrompt}
        onConfirm={handlePromptSubmit}
        onCancel={handlePromptCancel}
      />

      <CancelConfirmModal 
        isOpen={flow.showCancelConfirm}
        onConfirm={() => {
          handleCancel();
          flow.setShowCancelConfirm(false);
        }}
        onCancel={() => flow.setShowCancelConfirm(false)}
      />

      <WritingFinishModal 
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

      <AdaptiveContainer maxWidth={textWidth >= 1400 ? undefined : textWidth}>
        <AnimatePresence>
          {!classicNav && !showZen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.4 }}
              className="px-2 pt-6 pb-3 overflow-hidden"
            >
              <h1 className="text-2xl font-bold text-text-main"></h1>
              <p className="text-text-main/40 text-base font-mono mt-0.5"></p>
            </motion.div>
          )}
        </AnimatePresence>

        <WritingHeader 
          handleNewSession={handleNewSession}
          fetchUserSessions={fetchAllSessions}
          loadingSessions={loadingSessions}
          hasDraft={hasDraft}
          onOpenSettings={openSettings}
          handlePause={() => setSessionStatus('paused')}
          handleStart={handleStart}
          handleFinish={() => setSessionStatus('finished')}
          setShowCancelConfirm={flow.setShowCancelConfirm}
          totalDurationForDeadline={flow.totalDurationForDeadline}
        />

        <div className="relative">
          <AnimatePresence>
            {flow.setupMode && (
              <WritingSetup 
                setupMode={flow.setupMode}
                setSetupMode={flow.setSetupMode}
                startCountdown={flow.startCountdown}
                timerDuration={timerDuration}
                setTimerDuration={setTimerDuration}
                wordGoal={wordGoal}
                setWordGoal={setWordGoal}
                targetTime={targetTime}
                setTargetTime={setTargetTime}
                countdown={flow.countdown}
                userSessions={userSessions}
                continueSession={continueSession}
                isLocalOnly={isLocalOnly}
                setIsLocalOnly={setIsLocalOnly}
                encryptionPassword={encryptionPassword}
                setEncryptionPassword={setEncryptionPassword}
              />
            )}
            {sessionStatus === 'idle' && firstVisit && !flow.setupMode && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-12 space-y-4"
              >
                <p className="text-2xl font-bold text-text-main">
                  {t('onboarding_title')}
                </p>
                <p className="text-text-main/40 text-base max-w-sm mx-auto">
                  {t('onboarding_subtitle')}
                </p>
                <button
                  onClick={() => { setFirstVisit(false); handleNewSession(); }}
                  className="mt-4 px-8 py-3 rounded-2xl bg-text-main text-surface-base font-bold text-sm hover:opacity-90 transition-all"
                >
                  {t('onboarding_cta')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <WritingEditor 
            handlePause={() => setSessionStatus('paused')}
            handleStart={handleStart}
            handleFinish={() => setSessionStatus('finished')}
            setShowCancelConfirm={flow.setShowCancelConfirm}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
          />
        </div>
      </AdaptiveContainer>
    </motion.div>
  );
}

export function WritingPage(props: WritingViewProps) {
  return <WritingPageContent {...props} />;
}
