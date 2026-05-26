import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { useTimerStore } from '../store/useTimerStore';
import { useContentStore } from '../store/useContentStore';
import { Session, UserProfile } from '../../../types';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { GoalToast } from '../../../shared/components/GoalToast';
import { useLocation, useNavigate } from 'react-router-dom';
import { SeoHead } from '../../../core/i18n/SeoHead';

import { WritingFinishModal } from '../components/WritingFinishModal';
import { FlowPulse } from '../../../core/theme/FlowPulse';
import { CancelConfirmModal } from '../../../shared/components/CancelConfirmModal';

import { useSessionFlow } from '../hooks/useSessionFlow';
import { MobileWriteScreen } from '../components/MobileWriteScreen';
import { MobileHomeScreen } from '../components/MobileHomeScreen';
import { MobileSessionSetupSheet } from '../components/MobileSessionSetupSheet';
import { useLifeLog } from '../hooks/useLifeLog';
import { useStreak } from '../hooks/useStreak';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { SyncService } from '../../../core/services/SyncService';

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

function WritingPageUI({ session, profile, user: _user }: { session: AnySessionReturn; profile: UserProfile | null; user: User | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const sessionToContinue = (location.state as { sessionToContinue?: Session | null } | null)?.sessionToContinue || null;
  const isGuest = session.isGuest;
  const userId = session.userId;

  const timeGoalReached = useTimerStore(s => s.timeGoalReached);
  const wordGoalReached = useTimerStore(s => s.wordGoalReached);

  const sessionStatus = session.status;
  const tags = session.tags;
  const setTags = session.setTags;
  const labelId = session.labelId;
  const setLabelId = session.setLabelId;
  const sessionType = session.sessionType;
  const setSessionType = session.setSessionType;
  const setTitle = useContentStore(s => s.setTitle);

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
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && sessionStatus === 'writing') {
        handlePause();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [sessionStatus, handlePause]);

  const continueRef = useRef(false);
  useEffect(() => { continueRef.current = false; }, [userId]);
  useEffect(() => {
    if (sessionToContinue && !continueRef.current) {
      continueRef.current = true;
      navigate(location.pathname, { state: {}, replace: true });
      handleContinueSession(sessionToContinue);
    }
  }, [sessionToContinue, handleContinueSession, navigate, location.pathname]);

  const { sessionGroups: lifeLogGroups, summary: lifeLogSummary, refresh: refreshLifeLog } = useLifeLog(userId, isGuest);
  const streakDays = useStreak(lifeLogGroups);

  const streakForModal = React.useMemo(() => {
    if (!isFinishModalOpen) return streakDays;
    const todayStr = new Date().toDateString();
    const hasSessionToday = lifeLogGroups.some(g =>
      new Date(g.date).toDateString() === todayStr
    );
    return hasSessionToday ? streakDays : streakDays + 1;
  }, [streakDays, lifeLogGroups, isFinishModalOpen]);


  const onFinishClick = React.useCallback(() => {
    handleFinish(keystrokeTrackerRef);
    setIsFinishModalOpen(true);
  }, [handleFinish]);

  const isMobile = useLayoutMode().layoutMode !== 'desktop';

  // [L-09] desktopProps мемоизированы — не пересоздаются при мобильном рендере
  const desktopProps = React.useMemo(() => ({
    profile,
    setupMode: flow.setupMode,
    setSetupMode: setSetupMode,
    startCountdown,
    countdown: flow.countdown,
    totalDurationForDeadline: flow.totalDurationForDeadline,
    onNew: handleNew,
    onOpenLog: handleOpen,
    onSave: onFinishClick,
    onPlay: handlePlay,
    onPause: handlePause,
    onStop: onFinishClick,
    onContinueSession: handleContinueSession,
    handlePlayRef,
    keystrokeTrackerRef,
    hasDraft,
    sessionStatus,
    userId,
    onContinueSessionOrDoc: handleContinueSessionOrDoc,
    restoreDraft: session.restoreDraft,
    discardDraft: session.discardDraft,
    onSetPromptTitle: setTitle,
    showZen,
    lifeLogVisible,
    setLifeLogVisible,
    lifeLogTab,
    setLifeLogTab,
    lifeLogPinned,
    setLifeLogPinned,
    saveStatus,
    streakDays,
  }), [profile, flow.setupMode, flow.countdown, flow.totalDurationForDeadline, setSetupMode, startCountdown,
    handleNew, handleOpen, onFinishClick, handlePlay, handlePause, handleContinueSession,
    handlePlayRef, keystrokeTrackerRef, hasDraft, sessionStatus, userId, handleContinueSessionOrDoc,
    session.restoreDraft, session.discardDraft, setTitle, showZen, lifeLogVisible, setLifeLogVisible,
    lifeLogTab, setLifeLogTab, lifeLogPinned, setLifeLogPinned, saveStatus, streakDays]);

  const mainContent = (() => {
    if (isMobile) {
      if (sessionStatus === 'idle')
        return (
          <MobileHomeScreen
            userId={userId}
            streakDays={streakDays}
            sessionGroups={lifeLogGroups}
            summary={lifeLogSummary}
            onStart={() => setSetupMode('selection')}
            onContinue={handleContinueSessionOrDoc}
            hasDraft={hasDraft}
            restoreDraft={session.restoreDraft}
            discardDraft={session.discardDraft}
            onRefresh={refreshLifeLog}
          />
        );
      return <MobileWriteScreen onPlay={handlePlay} onPause={handlePause} onStop={onFinishClick} onNew={handleNew} saveStatus={saveStatus} keystrokeTrackerRef={keystrokeTrackerRef} />;
    }
    return <DesktopWritingLayout {...desktopProps} />;
  })();

  return (
    <>
      {mainContent}
      <MobileSessionSetupSheet
        setupMode={flow.setupMode}
        setSetupMode={setSetupMode}
        startCountdown={startCountdown}
        countdown={flow.countdown}
      />
      <GoalToast visible={flow.goalToastVisible} type={flow.goalToastType} />
      <AnimatePresence>
        {flow.sessionStartFlash && (
          <motion.div
            initial={{ opacity: 0.6 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="fixed inset-0 z-[var(--z-auth)] bg-text-main pointer-events-none"
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
        onSkipSave={() => setIsFinishModalOpen(false)}
        streakDays={streakForModal}
        sessionGroups={lifeLogGroups}
      />
      <FlowPulse isActive={sessionStatus === 'writing'} />
      {import.meta.env.DEV && devKpmStats && (
        <div className="fixed bottom-2 left-2 text-label font-mono text-text-main/30 z-50 pointer-events-none">
          KPM {devKpmStats.kpm} · IKI {devKpmStats.ikiMedian}ms · CV {devKpmStats.ikiCv}
        </div>
      )}
    </>
  );
}

export function WritingPage({ user, profile }: WritingViewProps) {
  return (
    <>
      <SeoHead
        path="/"
        titleRu="justwriting — тихий редактор для свободного письма"
        titleEn="justwriting — a quiet editor for free writing"
        descriptionRu="Тихий редактор для свободного письма. Без отвлечений. Режим потока, шифрование, серия дней."
        descriptionEn="A quiet editor for free writing. No distractions. Stream mode, encryption, writing streaks."
      />
      <WritingPageContent user={user} profile={profile} />
    </>
  );
}
