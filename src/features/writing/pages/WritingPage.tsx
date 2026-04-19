import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { Session, UserProfile, SessionPayload } from '../../../types';
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
import { LifeLogPanel } from '../components/LifeLogPanel';
import { WritingSessionService } from '../services/WritingSessionService';
import { WritingDraftService } from '../services/WritingDraftService';
import { FlowPulse } from '../../../core/theme/FlowPulse';

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
import { useToast } from '../../../shared/components/Toast';

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
    sessionType, setSessionType,
    setTimerDuration,
    setWordGoal,
    targetTime, setTargetTime,
    seconds,
    isPublic, setIsPublic,
    isAnonymous, setIsAnonymous,
    tags, setTags,
    labelId, setLabelId,
    hasDraft,
    saveStatus, lastSavedAt,
    handleStart: hookHandleStart, handleSave, handleCancel, resetSessionMetadata,
    isOnline,
    fetchLocalSessions,
    loadLocalSession,
    encryptionPassword, setEncryptionPassword,
    decryptSession,
    setActiveSessionId
  } = useWritingSession(user, profile);

  // 1. All hooks unconditionally:
  const { 
    isZenActive, zenModeEnabled, 
    editorWidth, 
    setStatus: setUIStatus,
    betaLifeLog,
    betaRedesign,
    lifeLogVisible, setLifeLogVisible,
    lifeLogTab, setLifeLogTab,
    lifeLogPinned, setLifeLogPinned
  } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const { showToast } = useToast();
  const title = useWritingStore(s => s.title);
  const setTitle = useWritingStore(s => s.setTitle);
  
  // Existing hooks that were already there
  const sessionStatus = useWritingStore(s => s.status);
  const setSessionStatus = useWritingStore(s => s.setStatus);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const wordCount = useWritingStore(s => s.wordCount);

  const flow = useSessionFlow(
    hookHandleStart, sessionStatus, sessionType, setSessionType,
    targetTime, seconds, timeGoalReached, wordGoalReached,
    betaLifeLog
  );

  const handleStart = React.useCallback((type?: 'words' | 'timer' | 'free') => {
    if (betaLifeLog) {
      useWritingStore.getState().setSessionType('free');
      useWritingStore.getState().setSessionStart();
      hookHandleStart();
    } else {
      flow.startCountdown(type || 'free');
    }
  }, [flow, betaLifeLog, hookHandleStart]);

  const handleFinish = () => setSessionStatus('finished');

  const [isLocalOnly, setIsLocalOnly] = useState(false);
  const { openSettings } = useSettings();
  const savingRef = React.useRef(false);

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

  // Edit loaded session immediately in Beta life log
  const handleBetaContinueSession = React.useCallback(async (session: Session) => {
    await continueSession(session);
    if (betaLifeLog) {
      flow.setSetupMode(null);
      setSessionStatus('writing');
      useWritingStore.getState().setSessionStart();
      // Fix 4 — WPM сбрасывать при смене заметки
      useWritingStore.setState({
        wpm: 0,
        wordSnapshots: [],
        lastWordCount: 0,
      });
    }
  }, [continueSession, betaLifeLog, setSessionStatus, flow]);

  const [firstVisit, setFirstVisit] = useLocalStorage('first-visit', true, z.boolean());

  useEffect(() => {
    setUIStatus(sessionStatus);
  }, [sessionStatus, setUIStatus]);

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
  }, [sessionToContinue, continueSession, navigate, location.pathname]);

  const handleNewSession = () => {
    resetSessionMetadata();
    flow.setSetupMode('selection');
  };

  // Beta mode handlers
  const handleBetaNew = () => {
    const state = useWritingStore.getState();
    if (state.wordCount > 0 && state.status !== 'idle') {
      flow.setShowCancelConfirm(true);
      return;
    }
    useWritingStore.getState().resetSession();
    useWritingStore.setState({ title: '', content: '' });
  };

  const handleBetaOpen = async () => {
    await fetchSessions();
    setLifeLogVisible(true);
  };

  const handleBetaSave = React.useCallback(async () => {
    if (sessionStatus === 'idle' || wordCount === 0) return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const state = useWritingStore.getState();
      
      const sessionData: SessionPayload = {
        userId: user.uid,
        authorName: profile?.nickname || user.displayName || user.email?.split('@')[0] || 'Anonymous',
        authorPhoto: user.photoURL || '',
        nickname: profile?.nickname || '',
        isAnonymous: isAnonymous,
        title: state.title || '',
        content: state.content,
        pinnedThoughts: state.pinnedThoughts,
        duration: state.accumulatedDuration + (state.seconds - state.sessionStartSeconds),
        wordCount: state.wordCount,
        charCount: state.content.length,
        wpm: state.wpm,
        isPublic: isPublic,
        tags: tags,
        sessionType: state.sessionType,
        sessionStartTime: state.sessionStartTime,
        goalReached: state.sessionType === 'timer' ? state.timeGoalReached : (state.sessionType === 'words' ? state.wordGoalReached : true),
      };

      const savedId = await WritingSessionService.saveSession(
        sessionData, 
        state.activeSessionId, 
        isOnline, 
        user.uid
      );
      
      if (savedId && !state.activeSessionId) {
        useWritingStore.getState().setActiveSessionId(savedId);
      }
      
      await fetchSessions();
      showToast(t('beta_save_success'), 'success');
    } catch (e) {
      console.error('Save failed:', e);
      showToast(t('beta_save_error'), 'error');
    } finally {
      savingRef.current = false;
    }
  }, [sessionStatus, wordCount, user, isPublic, isAnonymous, tags, profile, isOnline, showToast, t, fetchSessions]);

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

      // New: Cmd+S for save in Beta mode
      if (betaLifeLog && (e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleBetaSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionStatus, handleStart, setSessionStatus, betaLifeLog, handleBetaSave]);

  const handleBetaPlay = React.useCallback(() => {
    if (sessionStatus === 'idle') {
      useWritingStore.getState().setSessionType('free');
      useWritingStore.getState().setSessionStart();
      hookHandleStart();
    } else if (sessionStatus === 'paused') {
      useWritingStore.getState().setStatus('writing');
    }
  }, [sessionStatus, hookHandleStart]);

  const handleBetaPause = () => {
    if (sessionStatus !== 'writing') return;
    useWritingStore.getState().setStatus('paused');
  };

  const handleBetaStop = async () => {
    if (sessionStatus === 'idle') return;
    if (savingRef.current) return;
    await handleBetaSave();
    useWritingStore.getState().resetSession();
    useWritingStore.setState({ title: '', content: '' });
    await WritingDraftService.deleteDraft(user.uid);
  };

  const handleBetaPlayRef = React.useRef(handleBetaPlay);
  useEffect(() => {
    handleBetaPlayRef.current = handleBetaPlay;
  }, [handleBetaPlay]);

  const handleBetaKeyDown = React.useCallback((e: KeyboardEvent) => {
    if (!betaLifeLog) return;
    if (sessionStatus !== 'idle') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length !== 1) return; // only printable characters

    // Auto-start = same as Play
    handleBetaPlayRef.current();
  }, [betaLifeLog, sessionStatus]);

  useEffect(() => {
    window.addEventListener('keydown', handleBetaKeyDown);
    return () => window.removeEventListener('keydown', handleBetaKeyDown);
  }, [handleBetaKeyDown]);

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
        isOpen={sessionStatus === 'finished'}
        onClose={() => setSessionStatus('idle')}
        onConfirm={() => {
          handleSave();
          setSessionStatus('idle');
        }}
        title={title}
        setTitle={setTitle}
        sessionType={sessionType}
        wordCount={wordCount}
        duration={seconds}
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

      <AdaptiveContainer maxWidth={editorWidth >= 1400 ? undefined : editorWidth}>
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
          handlePause={betaLifeLog ? handleBetaPause : () => setSessionStatus('paused')}
          handleStart={betaLifeLog ? handleBetaPlay : handleStart}
          handleFinish={handleFinish}
          setShowCancelConfirm={flow.setShowCancelConfirm}
          totalDurationForDeadline={flow.totalDurationForDeadline}
          onNew={betaLifeLog ? handleBetaNew : handleNewSession}
          onOpenLog={betaLifeLog ? handleBetaOpen : handleBetaOpen}
          onSave={betaLifeLog ? handleBetaSave : handleFinish}
          onPlay={handleBetaPlay}
          onPause={handleBetaPause}
          onStop={betaLifeLog ? handleBetaStop : handleBetaStop}
        />

        <div className="relative">
          <AnimatePresence>
            {!betaLifeLog && flow.setupMode && (
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
            handleFinish={handleFinish}
            setShowCancelConfirm={flow.setShowCancelConfirm}
            saveStatus={saveStatus}
            lastSavedAt={lastSavedAt}
          />
        </div>
      </AdaptiveContainer>

      <AnimatePresence>
        {betaLifeLog && lifeLogVisible && (
          <LifeLogPanel 
            userId={user.uid} 
            onContinueSession={handleBetaContinueSession} 
            onClose={() => {
              if (!lifeLogPinned) setLifeLogVisible(false);
            }} 
            activeTab={lifeLogTab}
            onTabChange={setLifeLogTab}
            pinned={lifeLogPinned}
            onTogglePin={() => setLifeLogPinned(!lifeLogPinned)}
          />
        )}
      </AnimatePresence>

      {betaRedesign && <FlowPulse />}
    </motion.div>
  );
}

export function WritingPage(props: WritingViewProps) {
  return <WritingPageContent {...props} />;
}
