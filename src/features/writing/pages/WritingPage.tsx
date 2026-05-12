import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { Session, UserProfile } from '../../../types';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useSettings } from '../../../core/settings/SettingsContext';
import { GoalToast } from '../../../shared/components/GoalToast';
import { useLocation, useNavigate } from 'react-router-dom';

import { WritingFinishModal } from '../WritingFinishModal';
import { FlowPulse } from '../../../core/theme/FlowPulse';
import { CancelConfirmModal } from '../../../shared/components/CancelConfirmModal';

import { useSessionFlow } from '../hooks/useSessionFlow';
import { MobileWriteScreen } from '../components/MobileWriteScreen';
import { MobileHomeScreen } from '../components/MobileHomeScreen';
import { useLifeLog } from '../hooks/useLifeLog';
import { useStreak } from '../hooks/useStreak';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { SyncService } from '../services/SyncService';
import { OnboardingGoalScreen } from '../components/OnboardingGoalScreen';

import { useGuestWritingSession } from '../hooks/useGuestWritingSession';
import { useCloudWritingSession } from '../hooks/useCloudWritingSession';
import { useWritingActions, AnySessionReturn } from '../hooks/useWritingActions';
import { useWritingKeyboard } from '../hooks/useWritingKeyboard';
import { KeystrokeTracker, KeystrokeStats } from '../utils/keystrokeTracker';
import { DesktopWritingLayout } from './DesktopWritingLayout';

export type { AnySessionReturn };

interface WritingViewProps {
  user: User | null;
  profile: UserProfile | null;
}

function AuthenticatedWritingPage({ user, profile }: { user: User; profile: UserProfile | null }) {
  const session = useCloudWritingSession(user, profile);
  return <WritingPageUI session={session} profile={profile} user={user} />;
}

function GuestWritingPageInner() {
  const session = useGuestWritingSession();
  return <WritingPageUI session={session} profile={null} user={null} />;
}

function WritingPageContent({ user, profile }: WritingViewProps) {
  if (user) {
    return <AuthenticatedWritingPage user={user} profile={profile} />;
  }
  return <GuestWritingPageInner />;
}

function WritingPageUI({ session, profile, user }: { session: AnySessionReturn; profile: UserProfile | null; user: User | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const sessionToContinue = (location.state as { sessionToContinue?: Session | null } | null)?.sessionToContinue || null;
  const isGuest = session.isGuest;
  const userId = session.userId;

  const timeGoalReached = useWritingStore(s => s.timeGoalReached);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);
  const setWordGoalVal = useWritingStore(s => s.setWordGoal);

  const sessionStatus = session.status;
  const tags = session.tags;
  const setTags = session.setTags;
  const labelId = session.labelId;
  const setLabelId = session.setLabelId;
  const sessionType = session.sessionType;
  const setSessionType = session.setSessionType;
  const setTitle = useWritingStore(s => s.setTitle);

  const {
    targetTime,
    hasDraft,
    saveStatus,
    handleStart: hookHandleStart, handleCancel,
  } = session;

  const {
    isZenActive, zenModeEnabled,
    setStatus: setUIStatus,
    lifeLogVisible, setLifeLogVisible,
    lifeLogTab, setLifeLogTab,
    lifeLogPinned, setLifeLogPinned,
  } = useWritingSettings();
  const isBrowserOnline = useOnlineStatus();

  useEffect(() => {
    if (isBrowserOnline && !isGuest) {
      SyncService.syncPending(userId).catch(console.error);
    }
  }, [isBrowserOnline, isGuest, userId]);

  const showZen = isZenActive && zenModeEnabled;

  const flow = useSessionFlow(
    hookHandleStart, sessionStatus, sessionType, setSessionType,
    targetTime, session.seconds, timeGoalReached, wordGoalReached
  );
  const { setSetupMode, setShowCancelConfirm, startCountdown } = flow;

  const actions = useWritingActions({ session, flow });
  const { handleSave, handlePlay, handlePause, handleNew, handleFinish, handleOpen, handleContinueSession, handleContinueSessionOrDoc } = actions;

  const handlePlayRef = React.useRef(handlePlay);
  const handlePauseRef = React.useRef(handlePause);

  useEffect(() => {
    handlePlayRef.current = handlePlay;
    handlePauseRef.current = handlePause;
  }, [handlePlay, handlePause]);

  useWritingKeyboard({ sessionStatus, handlePlayRef, handlePauseRef });

  const { openSettings } = useSettings();
  const keystrokeTrackerRef = React.useRef(new KeystrokeTracker());
  const [devKpmStats, setDevKpmStats] = React.useState<KeystrokeStats | null>(null);
  const [isFinishModalOpen, setIsFinishModalOpen] = useState(false);

  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    const interval = setInterval(() => {
      setDevKpmStats(keystrokeTrackerRef.current.getStats());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setUIStatus(sessionStatus);
  }, [sessionStatus, setUIStatus]);

  useEffect(() => {
    if (sessionToContinue) {
      handleContinueSession(sessionToContinue);
      navigate(location.pathname, { state: {}, replace: true });
    }
  }, [sessionToContinue, handleContinueSession, navigate, location.pathname]);

  const { sessionGroups: lifeLogGroups, summary: lifeLogSummary } = useLifeLog(userId, isGuest);
  const streakDays = useStreak(userId, user ?? null);

  const streakForModal = React.useMemo(() => {
    const todayStr = new Date().toDateString();
    const hasSessionToday = lifeLogGroups.some(g =>
      new Date(g.date).toDateString() === todayStr
    );
    return hasSessionToday ? streakDays : streakDays + 1;
  }, [streakDays, lifeLogGroups]);

  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem('onboarding_done')
  );

  const handleOnboardingComplete = React.useCallback((goal: number) => {
    setWordGoalVal(goal);
    localStorage.setItem('onboarding_done', '1');
    setShowOnboarding(false);
  }, [setWordGoalVal]);

  const onFinishClick = React.useCallback(() => {
    handleFinish(keystrokeTrackerRef);
    setIsFinishModalOpen(true);
  }, [handleFinish]);

  const isMobile = useLayoutMode().layoutMode !== 'desktop';

  const sharedOverlays = (
    <>
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
      <CancelConfirmModal
        isOpen={flow.showCancelConfirm}
        onConfirm={() => { handleCancel(); setShowCancelConfirm(false); }}
        onCancel={() => setShowCancelConfirm(false)}
      />
      <WritingFinishModal
        isOpen={isFinishModalOpen}
        tags={tags} setTags={setTags}
        labelId={labelId} setLabelId={setLabelId}
        labels={profile?.labels || []}
        onSave={handleSave}
        onCancel={() => {
          if (sessionStatus === 'paused' && session.content) {
            handlePlay();
          }
          setIsFinishModalOpen(false);
        }}
        streakDays={streakDays}
        sessionGroups={lifeLogGroups}
      />
      <FlowPulse />
      {import.meta.env.DEV && devKpmStats && (
        <div className="fixed bottom-2 left-2 text-[10px] font-mono text-text-main/30 z-50 pointer-events-none">
          KPM {devKpmStats.kpm} · IKI {devKpmStats.ikiMedian}ms · CV {devKpmStats.ikiCv}
        </div>
      )}
    </>
  );

  if (showOnboarding && sessionStatus === 'idle') {
    return (
      <div className="min-h-screen flex flex-col">
        <OnboardingGoalScreen onComplete={handleOnboardingComplete} setWordGoal={setWordGoalVal} />
        {sharedOverlays}
      </div>
    );
  }

  if (isMobile) {
    if (sessionStatus === 'idle') {
      return (
        <>
          <MobileHomeScreen
            userId={userId}
        streakDays={streakForModal}
            sessionGroups={lifeLogGroups}
            summary={lifeLogSummary}
            onStart={handlePlay}
            onContinue={handleContinueSessionOrDoc}
          />
          {sharedOverlays}
        </>
      );
    }
    return (
      <>
        <MobileWriteScreen
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={onFinishClick}
          saveStatus={saveStatus}
        />
        {sharedOverlays}
      </>
    );
  }

  return (
    <>
      <DesktopWritingLayout
        profile={profile}
        setupMode={flow.setupMode}
        setSetupMode={setSetupMode}
        startCountdown={startCountdown}
        countdown={flow.countdown}
        totalDurationForDeadline={flow.totalDurationForDeadline}
        onOpenSettings={openSettings}
        onNew={handleNew}
        onOpenLog={handleOpen}
        onSave={onFinishClick}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={onFinishClick}
        onContinueSession={handleContinueSession}
        handlePlayRef={handlePlayRef}
        keystrokeTrackerRef={keystrokeTrackerRef}
        hasDraft={hasDraft}
        sessionStatus={sessionStatus}
        userId={userId}
        onContinueSessionOrDoc={handleContinueSessionOrDoc}
        loadDraft={session.loadDraft}
        discardDraft={session.discardDraft}
        onSetPromptTitle={setTitle}
        showZen={showZen}
        lifeLogVisible={lifeLogVisible}
        setLifeLogVisible={setLifeLogVisible}
        lifeLogTab={lifeLogTab}
        setLifeLogTab={setLifeLogTab}
        lifeLogPinned={lifeLogPinned}
        setLifeLogPinned={setLifeLogPinned}
      />
      {sharedOverlays}
    </>
  );
}

export function WritingPage({ user, profile }: WritingViewProps) {
  return <WritingPageContent user={user} profile={profile} />;
}
