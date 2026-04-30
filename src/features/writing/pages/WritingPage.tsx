import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { Session, UserProfile } from '../../../types';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useSettings } from '../../../core/settings/SettingsContext';
import { cn } from '../../../core/utils/utils';
import { GoalToast } from '../../../shared/components/GoalToast';
import { useLocation, useNavigate } from 'react-router-dom';

import { WritingHeader } from '../WritingHeader';
import { WritingEditor } from '../WritingEditor';
import { WritingFinishModal } from '../WritingFinishModal';
import { LifeLogPanel } from '../components/LifeLogPanel';
import { WritingSetup } from '../WritingSetup';
import { WritingDraftService } from '../services/WritingDraftService';
import { FlowPulse } from '../../../core/theme/FlowPulse';
import { BottomStats } from '../components/BottomStats';
import { Sidebar } from '../../navigation/components/Sidebar';

import { CancelConfirmModal } from '../components/modals/CancelConfirmModal';

import { useSessionList } from '../hooks/useSessionList';
import { useSessionContinue } from '../hooks/useSessionContinue';
import { useSessionFlow } from '../hooks/useSessionFlow';
import { useLanguage } from '../../../core/i18n';
import { ConnectionStatusBanner } from '../components/ConnectionStatusBanner';
import { MobileWriteScreen } from '../components/MobileWriteScreen';
import { MobileHomeScreen } from '../components/MobileHomeScreen';
import { useLifeLog } from '../hooks/useLifeLog';
import { useDocuments } from '../hooks/useDocuments';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { SyncService } from '../services/SyncService';
import { useToast } from '../../../shared/components/Toast';

import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { StorageService } from '../services/StorageService';
import { LocalVersionService } from '../services/LocalVersionService';
import { z } from 'zod';
import { SaveData } from '../WritingFinishModal';
import { LifeLogDocument } from '../hooks/useLifeLog';

import { useGuestWritingSession, GuestSessionReturn } from '../hooks/useGuestWritingSession';
import { useCloudWritingSession, CloudSessionReturn } from '../hooks/useCloudWritingSession';
import { BaseSessionReturn } from '../hooks/useBaseWritingSession';

type AnySessionReturn = GuestSessionReturn | CloudSessionReturn;

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
  const setSessionStatus = session.setStatus;
  const title = session.title;
  const setTitle = session.setTitle;
  const seconds = session.seconds;
  const wordCount = session.wordCount;
  const wordGoal = session.wordGoal;
  const timerDuration = session.timerDuration;
  const tags = session.tags;
  const setTags = session.setTags;
  const labelId = session.labelId;
  const setLabelId = session.setLabelId;
  const sessionType = session.sessionType;
  const setSessionType = session.setSessionType;

  const {
    setTimerDuration,
    setWordGoal,
    targetTime, setTargetTime,
    hasDraft,
    saveStatus, lastSavedAt,
    handleStart: hookHandleStart, handleCancel, resetSessionMetadata,
    isOnline,
    fetchLocalSessions,
    loadLocalSession,
    setActiveSessionId
  } = session;

  const { 
    isZenActive, zenModeEnabled, 
    editorWidth, 
    setStatus: setUIStatus,
    lifeLogEnabled,
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
  const { showToast } = useToast();

  const flow = useSessionFlow(
    hookHandleStart, sessionStatus, sessionType, setSessionType,
    targetTime, seconds, timeGoalReached, wordGoalReached
  );

  const { openSettings } = useSettings();
  const savingRef = React.useRef(false);
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

  const { continueSession } = useSessionContinue({
    setSetupMode: flow.setSetupMode,
    setTags,
    loadLocalSession,
  });

  const handleContinueDocument = React.useCallback(async (doc: LifeLogDocument) => {
    try {
      let localId = doc.localId || '';
      let content = '';

      if (localId) {
        content = await LocalVersionService.getLatestContent(localId);
      } else if (doc.cloudId) {
        try {
          localId = await StorageService.addLocalCopy(userId, doc.cloudId);
          content = await LocalVersionService.getLatestContent(localId);
        } catch (e) {
          console.error('Failed to import cloud doc for continue:', e);
        }
      }

      useWritingStore.setState({
        content,
        title: doc.title,
        wordCount: doc.totalWords,
        savedDocumentId: localId,
        wpm: 0,
        wordSnapshots: [],
        lastWordCount: 0,
      });

      useWritingStore.getState().setSessionStart();
      setSessionStatus('writing');
      setLifeLogVisible(false);
    } catch (err) {
      console.error('Failed to load document:', err);
      showToast(t('error_load_failed'), 'error');
    }
  }, [setSessionStatus, setLifeLogVisible, showToast, t]);

  const handleContinueSession = React.useCallback(async (session: Session) => {
    try {
      await continueSession(session);
      flow.setSetupMode(null);
      setSessionStatus('writing');
      useWritingStore.getState().setSessionStart();
      useWritingStore.setState({
        wpm: 0,
        wordSnapshots: [],
        lastWordCount: 0,
      });
    } catch (err) {
      console.error('Continue session error:', err);
      showToast(t('error_continue_session'));
    }
  }, [continueSession, setSessionStatus, flow, showToast, t]);

  const handleContinueSessionOrDoc = React.useCallback(async (sessionOrDoc: Session | LifeLogDocument) => {
    if ('totalWords' in sessionOrDoc && 'localId' in sessionOrDoc) {
      await handleContinueDocument(sessionOrDoc as LifeLogDocument);
    } else {
      await handleContinueSession(sessionOrDoc as Session);
    }
  }, [handleContinueDocument, handleContinueSession]);

  const [firstVisit, setFirstVisit] = useLocalStorage('first-visit', true, z.boolean());

  const { documents, refresh: refreshDocuments } = useDocuments(userId, isGuest);

  const { sessionGroups: lifeLogGroups, summary: lifeLogSummary, refresh: refreshLifeLog } = useLifeLog(userId, isGuest);

  const { userSessions, loadingSessions, fetchAllSessions: fetchSessions } = useSessionList(
    userId,
    fetchLocalSessions,
    loadLocalSession
  );

  useEffect(() => {
    setUIStatus(sessionStatus);
  }, [sessionStatus, setUIStatus]);

  useEffect(() => {
    if (sessionToContinue) {
      handleContinueSession(sessionToContinue);
      navigate(location.pathname, { state: {}, replace: true });
    }
  }, [sessionToContinue, handleContinueSession, navigate, location.pathname]);
  const streakDays = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let streak = 0;
    let checkDate = new Date(today);
    for (let i = 0; i < 365; i++) {
      const dateStr = checkDate.toDateString();
      const hasSession = lifeLogGroups.some(g =>
        new Date(g.date).toDateString() === dateStr
      );
      if (hasSession) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }, [lifeLogGroups]);

  const handleSave = React.useCallback(async (data: SaveData) => {
    if (savingRef.current) return;
    savingRef.current = true;

    try {
      const state = useWritingStore.getState();
      const sessionSeconds = state.accumulatedDuration +
        Math.max(0, state.seconds - state.sessionStartSeconds);

      const saveData = {
        title: data.title || state.title || '',
        content: state.content,
        wordCount: state.wordCount,
        duration: sessionSeconds,
        wpm: state.wpm,
        isPublic: false,
        tags: data.tags,
        labelId: data.labelId,
        goalWords: state.wordGoal > 0 ? state.wordGoal : undefined,
        goalTime: state.timerDuration > 0 ? state.timerDuration : undefined,
        goalReached: state.wordGoal > 0 && state.wordCount >= state.wordGoal,
        sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
      };

      const existingDocId = state.savedDocumentId;

      if (existingDocId) {
        await StorageService.saveVersion(userId, existingDocId, saveData);
      } else {
        const result = await StorageService.saveNew(userId, saveData);
        useWritingStore.getState().setSavedDocumentId(result.localId);
      }

      try {
        if (isGuest) {
          localStorage.removeItem('jw_guest_draft');
        } else {
          await WritingDraftService.deleteDraft(userId);
        }
      } catch {}

      await refreshDocuments();
      await refreshLifeLog();

      useWritingStore.getState().finishSession();
    } catch (e) {
      console.error('Save failed:', e);
      throw e;
    } finally {
      savingRef.current = false;
    }
  }, [userId, isGuest, refreshDocuments, refreshLifeLog, showToast, t]);

  const handlePlay = React.useCallback(() => {
    if (sessionStatus === 'idle') {
      useWritingStore.getState().setSessionType('free');
      useWritingStore.getState().setSessionStart();
      hookHandleStart();
    } else if (sessionStatus === 'paused') {
      useWritingStore.getState().setStatus('writing');
    }
  }, [sessionStatus, hookHandleStart]);

  const handlePause = React.useCallback(() => {
    if (sessionStatus !== 'writing') return;
    useWritingStore.getState().setStatus('paused');
  }, [sessionStatus]);

  const handleStop = React.useCallback(() => {
    if (sessionStatus === 'idle') return;
    setSessionStatus('finished');
  }, [sessionStatus, setSessionStatus]);

  const handlePlayRef = React.useRef(handlePlay);
  const handlePauseRef = React.useRef(handlePause);

  useEffect(() => {
    handlePlayRef.current = handlePlay;
    handlePauseRef.current = handlePause;
  }, [handlePlay, handlePause]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        if (sessionStatus === 'writing' || sessionStatus === 'paused') {
          e.preventDefault();
          if (sessionStatus === 'writing') {
            handlePauseRef.current();
          } else if (sessionStatus === 'paused') {
            handlePlayRef.current();
          }
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionStatus]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const state = useWritingStore.getState();
      if (state.status === 'writing' || state.status === 'paused') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleAutoStartKey = React.useCallback((e: KeyboardEvent) => {
    if (sessionStatus !== 'idle') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length !== 1) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (target.closest('[data-modal]')) return;
    if (target.isContentEditable && target.closest('[data-modal]')) return;
    handlePlayRef.current();
  }, [sessionStatus]);

  useEffect(() => {
    window.addEventListener('keydown', handleAutoStartKey);
    return () => window.removeEventListener('keydown', handleAutoStartKey);
  }, [handleAutoStartKey]);

  const fetchAllSessions = React.useCallback(async () => {
    await fetchSessions();
    flow.setSetupMode('session-selection');
  }, [fetchSessions, flow]);

  const handleNewSession = React.useCallback(() => {
    resetSessionMetadata();
    flow.setSetupMode('selection');
  }, [resetSessionMetadata, flow]);

  const handleNew = React.useCallback(() => {
    if (wordCount > 0 && sessionStatus !== 'idle') {
      flow.setShowCancelConfirm(true);
      return;
    }
    useWritingStore.getState().resetSession();
    useWritingStore.setState({ title: '', content: '' });
  }, [wordCount, sessionStatus, flow]);

  const handleOpen = React.useCallback(async () => {
    await fetchSessions();
    setLifeLogVisible(true);
  }, [fetchSessions, setLifeLogVisible]);

  const handleFinish = React.useCallback(() => setSessionStatus('finished'), [setSessionStatus]);

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
        onConfirm={() => { handleCancel(); flow.setShowCancelConfirm(false); }}
        onCancel={() => flow.setShowCancelConfirm(false)}
      />
      <WritingFinishModal 
        isOpen={sessionStatus === 'finished'}
        tags={tags} setTags={setTags}
        labelId={labelId} setLabelId={setLabelId}
        labels={profile?.labels || []}
        isGuest={isGuest}
        onSave={handleSave}
      />
      <FlowPulse />
    </>
  );

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
          onStop={handleFinish}
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
              handleNewSession={handleNewSession}
              fetchUserSessions={fetchAllSessions}
              loadingSessions={loadingSessions}
              hasDraft={hasDraft}
              onOpenSettings={openSettings}
              handlePause={handlePause}
              handleStart={handlePlay}
              handleFinish={handleFinish}
              setShowCancelConfirm={flow.setShowCancelConfirm}
              totalDurationForDeadline={flow.totalDurationForDeadline}
              onNew={handleNew}
              onOpenLog={handleOpen}
              onSave={handleFinish}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleFinish}
            />
          </div>

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
                  setSetupMode={flow.setSetupMode}
                  startCountdown={flow.startCountdown}
                  timerDuration={timerDurationVal}
                  setTimerDuration={setTimerDurationVal}
                  wordGoal={wordGoalVal}
                  setWordGoal={setWordGoalVal}
                  targetTime={targetTimeVal}
                  setTargetTime={setTargetTimeVal}
                  countdown={flow.countdown}
                  userSessions={userSessions}
                  continueSession={handleContinueSession}
                />
              ) : (
              <WritingEditor 
                handlePause={() => setSessionStatus('paused')}
                handleStart={() => {
                  useWritingStore.getState().setSessionType('free');
                  useWritingStore.getState().setSessionStart();
                  hookHandleStart();
                }}
                handleFinish={handleFinish}
                setShowCancelConfirm={flow.setShowCancelConfirm}
                saveStatus={saveStatus}
                lastSavedAt={lastSavedAt}
                onKeyDown={(e) => {
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
              onStop={handleFinish}
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
                  onRefreshDocuments={refreshDocuments}
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
