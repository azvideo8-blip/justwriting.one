import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { Session, UserProfile } from '../../../types';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useSettings } from '../../../core/settings/SettingsContext';
import { cn, calculateStreak } from '../../../core/utils/utils';
import { GoalToast } from '../../../shared/components/GoalToast';
import { useLocation, useNavigate } from 'react-router-dom';

import { WritingHeader } from '../WritingHeader';
import { WritingEditor } from '../WritingEditor';
import { WritingFinishModal } from '../WritingFinishModal';
import { LifeLogPanel } from '../components/LifeLogPanel';
import { WritingSetup } from '../WritingSetup';
import { FlowPulse } from '../../../core/theme/FlowPulse';
import { BottomStats } from '../components/BottomStats';
import { Sidebar } from '../../navigation/components/Sidebar';
import { KeystrokeTracker, KeystrokeStats } from '../utils/keystrokeTracker';

import { CancelConfirmModal } from '../components/modals/CancelConfirmModal';

import { useSessionFlow } from '../hooks/useSessionFlow';
import { useLanguage } from '../../../core/i18n';
import { ConnectionStatusBanner } from '../components/ConnectionStatusBanner';
import { MobileWriteScreen } from '../components/MobileWriteScreen';
import { MobileHomeScreen } from '../components/MobileHomeScreen';
import { useLifeLog } from '../hooks/useLifeLog';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { SyncService } from '../services/SyncService';
import { OnboardingGoalScreen } from '../components/OnboardingGoalScreen';

import { useGuestWritingSession } from '../hooks/useGuestWritingSession';
import { useCloudWritingSession } from '../hooks/useCloudWritingSession';
import { useWritingActions, AnySessionReturn } from '../hooks/useWritingActions';
import { useWritingKeyboard } from '../hooks/useWritingKeyboard';

export type { AnySessionReturn };

interface WritingViewProps {
  user: User | null;
  profile: UserProfile | null;
}

function AuthenticatedWritingPage({ user, profile }: { user: User; profile: UserProfile | null }) {
  const session = useCloudWritingSession(user, profile);
  return <WritingPageUI session={session} profile={profile} />;
}

function GuestWritingPageInner() {
  const session = useGuestWritingSession();
  return <WritingPageUI session={session} profile={null} />;
}

function WritingPageContent({ user, profile }: WritingViewProps) {
  if (user) {
    return <AuthenticatedWritingPage user={user} profile={profile} />;
  }
  return <GuestWritingPageInner />;
}

function WritingPageUI({ session, profile }: { session: AnySessionReturn; profile: UserProfile | null }) {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const sessionToContinue = (location.state as { sessionToContinue?: Session | null } | null)?.sessionToContinue || null;
  const isGuest = session.isGuest;
  const userId = session.userId;

  const timeGoalReached = useWritingStore(s => s.timeGoalReached);
  const wordGoalReached = useWritingStore(s => s.wordGoalReached);
  const timerDurationVal = useWritingStore(s => s.timerDuration);
  const setTimerDurationVal = useWritingStore(s => s.setTimerDuration);
  const wordGoalVal = useWritingStore(s => s.wordGoal);
  const setWordGoalVal = useWritingStore(s => s.setWordGoal);
  const targetTimeVal = useWritingStore(s => s.targetTime);
  const setTargetTimeVal = useWritingStore(s => s.setTargetTime);

  const sessionStatus = session.status;
  const tags = session.tags;
  const setTags = session.setTags;
  const labelId = session.labelId;
  const setLabelId = session.setLabelId;
  const sessionType = session.sessionType;
  const setSessionType = session.setSessionType;

  const {
    targetTime,
    hasDraft,
    saveStatus,
    handleStart: hookHandleStart, handleCancel,
  } = session;

  const {
    isZenActive, zenModeEnabled,
    editorWidth,
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
  const editorColRef = React.useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  const { layoutMode } = useLayoutMode();

  React.useEffect(() => {
    const el = editorColRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setIsCompact(entry.contentRect.width < 600);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem('onboarding_done')
  );

  const handleOnboardingComplete = React.useCallback((goal: number) => {
    useWritingStore.getState().setWordGoal(goal);
    localStorage.setItem('onboarding_done', '1');
    setShowOnboarding(false);
  }, []);

  const streakDays = React.useMemo(() => {
    const allSessions = lifeLogGroups.flatMap(g => g.sessions);
    return calculateStreak(allSessions);
  }, [lifeLogGroups]);

  const onFinishClick = React.useCallback(() => {
    handleFinish(keystrokeTrackerRef);
    setIsFinishModalOpen(true);
  }, [handleFinish]);

  const LIFE_LOG_WIDTH = 380;
  const isMobile = layoutMode !== 'desktop';

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
        isGuest={isGuest}
        onSave={handleSave}
        onCancel={() => {
          const state = useWritingStore.getState();
          if (state.status === 'paused' && state.content) {
            useWritingStore.getState().setStatus('writing');
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
        <OnboardingGoalScreen onComplete={handleOnboardingComplete} />
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
            streakDays={streakDays}
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full transition-colors duration-1000"
    >
      <>
        <ConnectionStatusBanner showZen={showZen} />
        {sharedOverlays}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${showZen ? '0px' : 'auto'} 1fr ${lifeLogVisible ? `${LIFE_LOG_WIDTH}px` : '0px'}`,
            gridTemplateRows: '48px 1fr 64px',
            height: '100vh',
            width: '100vw',
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            transition: 'grid-template-columns 0.25s cubic-bezier(.4,.2,.2,1)',
            overflow: 'hidden',
          }}
        >
          <div style={{ gridColumn: '1', gridRow: '1 / 4', overflow: 'hidden' }}>
            <Sidebar isAdmin={!!profile?.role && profile.role === 'admin'} inGrid />
          </div>

          <div style={{ gridColumn: '2', gridRow: '1', overflow: 'hidden' }}>
            <WritingHeader
              totalDurationForDeadline={flow.totalDurationForDeadline}
              onOpenSettings={openSettings}
              onNew={handleNew}
              onOpenLog={handleOpen}
              onSave={onFinishClick}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={onFinishClick}
            />
          </div>

          {isGuest && hasDraft && sessionStatus === 'idle' && !flow.setupMode && (
            <div className="flex items-center justify-between px-4 py-2.5 mx-4 mt-2 rounded-xl border border-text-main/10 bg-text-main/[0.04] text-sm text-text-main/60">
              <span>{t('guest_draft_restore_prompt')}</span>
              <div className="flex gap-2">
                <button onClick={session.loadDraft} className="text-text-main font-medium hover:opacity-70 transition-opacity">
                  {t('guest_draft_restore')}
                </button>
                <button onClick={() => { session.setHasDraft(false); localStorage.removeItem('jw_guest_draft'); }}
                  className="text-text-main/40 hover:text-text-main/60 transition-colors">
                  {t('guest_draft_discard')}
                </button>
              </div>
            </div>
          )}

          <div ref={editorColRef} style={{
            gridColumn: '2',
            gridRow: '2',
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
          }}>
            <div style={{
              width: editorWidth < 100 ? `${editorWidth}%` : '100%',
              height: '100%',
              position: 'relative',
            }}
            className={cn(
              editorWidth < 100 && "rounded-2xl m-2 border border-border-subtle/40 backdrop-blur-sm bg-text-main/[0.02] shadow-xl"
            )}
            >
              {flow.setupMode ? (
                <WritingSetup
                  setupMode={flow.setupMode}
                  setSetupMode={setSetupMode}
                  startCountdown={startCountdown}
                  timerDuration={timerDurationVal}
                  setTimerDuration={setTimerDurationVal}
                  wordGoal={wordGoalVal}
                  setWordGoal={setWordGoalVal}
                  targetTime={targetTimeVal}
                  setTargetTime={setTargetTimeVal}
                  countdown={flow.countdown}
                  userSessions={[]}
                  continueSession={handleContinueSession}
                  onSetPromptTitle={(title) => useWritingStore.getState().setTitle(title)}
                />
              ) : (
              <WritingEditor
                onKeyDown={(e) => {
                  if (!e.metaKey && !e.ctrlKey && !e.altKey) {
                    keystrokeTrackerRef.current.record();
                  }
                  if (sessionStatus === 'idle' && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                    handlePlayRef.current();
                  } else if (sessionStatus === 'paused' && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                    handlePlayRef.current();
                  }
                }}
              />
              )}
            </div>
          </div>

          <div style={{ gridColumn: '2', gridRow: '3', overflow: 'hidden' }}>
            <BottomStats
              compact={isCompact}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={onFinishClick}
            />
          </div>

          <div style={{ gridColumn: '3', gridRow: '1 / 4', overflow: 'hidden' }}>
            <AnimatePresence>
              {lifeLogVisible && (
                <LifeLogPanel
                  userId={userId}
                  onContinueSession={handleContinueSessionOrDoc}
                  onClose={() => { if (!lifeLogPinned) setLifeLogVisible(false); }}
                  activeTab={lifeLogTab}
                  onTabChange={setLifeLogTab}
                  pinned={lifeLogPinned}
                  onTogglePin={() => setLifeLogPinned(!lifeLogPinned)}
                  inGrid
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </>
    </motion.div>
  );
}

export function WritingPage({ user, profile }: WritingViewProps) {
  return <WritingPageContent user={user} profile={profile} />;
}
