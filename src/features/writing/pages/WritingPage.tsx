import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from 'firebase/auth';
import { useWritingStore } from '../store/useWritingStore';
import { Session, UserProfile, SessionPayload } from '../../../types';
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

import { PasswordPromptModal } from '../components/modals/PasswordPromptModal';
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
import { useServiceAction } from '../hooks/useServiceAction';
import { UnifiedSessionService } from '../services/UnifiedSessionService';
import { useSessionSource } from '../hooks/useSessionSource';
import { LocalDocumentService } from '../services/LocalDocumentService';
import { z } from 'zod';
import { SaveData } from '../WritingFinishModal';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';

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

  const sessionStatus = session.status;
  const setSessionStatus = session.setStatus;
  const title = session.title;
  const setTitle = session.setTitle;
  const seconds = session.seconds;
  const wordCount = session.wordCount;
  const wordGoal = session.wordGoal;
  const timerDuration = session.timerDuration;
  const isPublic = session.isPublic;
  const setIsPublic = session.setIsPublic;
  const isAnonymous = session.isAnonymous;
  const setIsAnonymous = session.setIsAnonymous;
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
    handleStart: hookHandleStart, handleSave: hookHandleSave, handleCancel, resetSessionMetadata,
    isOnline,
    fetchLocalSessions,
    loadLocalSession,
    encryptionPassword, setEncryptionPassword,
    decryptSession,
    setActiveSessionId
  } = session;

  const { 
    isZenActive, zenModeEnabled, 
    editorWidth, 
    setStatus: setUIStatus,
    lifeLogEnabled,
    lifeLogVisible, setLifeLogVisible,
    lifeLogTab, setLifeLogTab,
    lifeLogPinned, setLifeLogPinned
  } = useWritingSettings();
  const source = useSessionSource();
  const isBrowserOnline = useOnlineStatus();

  useEffect(() => {
    if (isBrowserOnline && !isGuest) {
      SyncService.syncPending(userId).catch(console.error);
    }
  }, [isBrowserOnline, isGuest, userId]);

  const effectiveSource = !isBrowserOnline && source !== 'local' ? 'local' : source;
  const showZen = isZenActive && zenModeEnabled;
  const { showToast } = useToast();
  const { execute: svcExecute } = useServiceAction();

  const flow = useSessionFlow(
    hookHandleStart, sessionStatus, sessionType, setSessionType,
    targetTime, seconds, timeGoalReached, wordGoalReached
  );

  const [isLocalOnly, setIsLocalOnly] = useState(false);
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

  const handleSave = React.useCallback(async () => {
    if (sessionStatus === 'idle' || wordCount === 0) return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const state = useWritingStore.getState();
      const sessionSeconds = state.accumulatedDuration + (state.seconds - state.sessionStartSeconds);
      const saveData = {
        title: state.title || '',
        content: state.content,
        wordCount: state.wordCount,
        duration: sessionSeconds,
        wpm: state.wpm,
        isPublic: isPublic,
        tags: tags,
        labelId: state.labelId,
        goalWords: state.wordGoal > 0 ? state.wordGoal : undefined,
        goalTime: state.timerDuration > 0 ? state.timerDuration : undefined,
        goalReached: state.wordGoal > 0 && state.wordCount >= state.wordGoal,
        sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
      };

      const existingDocId = state.savedDocumentId;
      if (existingDocId) {
        await UnifiedSessionService.saveAsVersion(userId, existingDocId, saveData, effectiveSource);
      } else {
        const result = await UnifiedSessionService.saveAsNewDocument(userId, saveData, effectiveSource);
        useWritingStore.getState().setSavedDocumentId(result.documentId);
      }

      await refreshDocuments();
      refreshLifeLog();
      showToast(t('save_success'), 'success');
    } catch (e) {
      console.error('Save failed:', e);
      showToast(t('save_error'), 'error');
    } finally {
      savingRef.current = false;
    }
  }, [sessionStatus, wordCount, userId, isPublic, tags, isGuest, effectiveSource, showToast, t, refreshDocuments, refreshLifeLog]);

  const handleSaveAsNewDocument = React.useCallback(async (data: SaveData) => {
    const state = useWritingStore.getState();
    const sessionSeconds = state.accumulatedDuration + (state.seconds - state.sessionStartSeconds);

    await UnifiedSessionService.saveAsNewDocument(userId, {
      title: data.title,
      content: state.content,
      wordCount: state.wordCount,
      duration: sessionSeconds,
      wpm: state.wpm,
      isPublic: data.isPublic,
      tags: data.tags,
      labelId: data.labelId,
      goalWords: state.wordGoal > 0 ? state.wordGoal : undefined,
      goalTime: state.timerDuration > 0 ? state.timerDuration : undefined,
      goalReached: state.wordGoal > 0 && state.wordCount >= state.wordGoal,
      sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
    }, effectiveSource);

    await refreshDocuments();
    refreshLifeLog();
    useWritingStore.getState().finishSession();
    if (!isGuest) await WritingDraftService.deleteDraft(userId);
  }, [userId, refreshDocuments, effectiveSource, isGuest, refreshLifeLog]);

  const handleSaveAsVersion = React.useCallback(async (documentId: string, data: SaveData) => {
    const state = useWritingStore.getState();
    const sessionSeconds = state.accumulatedDuration + (state.seconds - state.sessionStartSeconds);

    await UnifiedSessionService.saveAsVersion(userId, documentId, {
      title: data.title,
      content: state.content,
      wordCount: state.wordCount,
      duration: sessionSeconds,
      wpm: state.wpm,
      isPublic: data.isPublic,
      tags: data.tags,
      labelId: data.labelId,
      goalWords: state.wordGoal > 0 ? state.wordGoal : undefined,
      goalTime: state.timerDuration > 0 ? state.timerDuration : undefined,
      goalReached: state.wordGoal > 0 && state.wordCount >= state.wordGoal,
      sessionStartedAt: new Date(Date.now() - sessionSeconds * 1000),
    }, effectiveSource);

    await refreshDocuments();
    refreshLifeLog();
    useWritingStore.getState().finishSession();
    if (!isGuest) await WritingDraftService.deleteDraft(userId);
  }, [userId, effectiveSource, refreshDocuments, isGuest, refreshLifeLog]);

  const handlePlay = React.useCallback(() => {
    if (sessionStatus === 'idle') {
      useWritingStore.getState().setSessionType('free');
      useWritingStore.getState().setSessionStart();
      hookHandleStart();
    } else if (sessionStatus === 'paused') {
      useWritingStore.getState().setStatus('writing');
    }
  }, [sessionStatus, hookHandleStart]);

  const handlePause = () => {
    if (sessionStatus !== 'writing') return;
    useWritingStore.getState().setStatus('paused');
  };

  const handleStop = async () => {
    if (sessionStatus === 'idle') return;
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await handleSave();
      useWritingStore.getState().finishSession();
      if (!isGuest) await WritingDraftService.deleteDraft(userId);
    } finally {
      savingRef.current = false;
    }
  };

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
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionStatus, handleSave]);

  const handleAutoStartKey = React.useCallback((e: KeyboardEvent) => {
    if (sessionStatus !== 'idle') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length !== 1) return;
    handlePlayRef.current();
  }, [sessionStatus]);

  useEffect(() => {
    window.addEventListener('keydown', handleAutoStartKey);
    return () => window.removeEventListener('keydown', handleAutoStartKey);
  }, [handleAutoStartKey]);

  const fetchAllSessions = async () => {
    await fetchSessions();
    flow.setSetupMode('session-selection');
  };

  const handleNewSession = () => {
    resetSessionMetadata();
    flow.setSetupMode('selection');
  };

  const handleNew = () => {
    const state = useWritingStore.getState();
    if (state.wordCount > 0 && state.status !== 'idle') {
      flow.setShowCancelConfirm(true);
      return;
    }
    useWritingStore.getState().resetSession();
    useWritingStore.setState({ title: '', content: '' });
  };

  const handleOpen = async () => {
    await fetchSessions();
    setLifeLogVisible(true);
  };

  const handleFinish = () => setSessionStatus('finished');

  const LIFE_LOG_WIDTH = 380;
  const isMobile = layoutMode !== 'desktop';

  const mobileModals = (
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
      <PasswordPromptModal 
        isOpen={!!passwordPrompt}
        onConfirm={handlePromptSubmit}
        onCancel={handlePromptCancel}
      />
      <CancelConfirmModal 
        isOpen={flow.showCancelConfirm}
        onConfirm={() => { handleCancel(); flow.setShowCancelConfirm(false); }}
        onCancel={() => flow.setShowCancelConfirm(false)}
      />
      <WritingFinishModal 
        isOpen={sessionStatus === 'finished'}
        onClose={() => useWritingStore.getState().finishSession()}
        onConfirm={() => { hookHandleSave(isLocalOnly); }}
        title={title} setTitle={setTitle}
        sessionType={sessionType} wordCount={wordCount} duration={seconds}
        isPublic={isPublic} setIsPublic={setIsPublic}
        isAnonymous={isAnonymous} setIsAnonymous={setIsAnonymous}
        handleSave={(localOnly?: boolean) => hookHandleSave(localOnly ?? isLocalOnly)}
        tags={tags} setTags={setTags}
        labelId={labelId} setLabelId={setLabelId}
        labels={profile?.labels || []}
        isLocalOnly={isLocalOnly}
        existingDocuments={documents}
        onSaveAsNew={handleSaveAsNewDocument}
        onSaveAsVersion={handleSaveAsVersion}
        effectiveSource={effectiveSource}
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
            onContinue={handleContinueSession}
          />
          {mobileModals}
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
        {mobileModals}
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
          onConfirm={() => { handleCancel(); flow.setShowCancelConfirm(false); }}
          onCancel={() => flow.setShowCancelConfirm(false)}
        />

        <WritingFinishModal 
          isOpen={sessionStatus === 'finished'}
          onClose={() => useWritingStore.getState().finishSession()}
          onConfirm={() => { hookHandleSave(isLocalOnly); }}
          title={title} setTitle={setTitle}
          sessionType={sessionType} wordCount={wordCount} duration={seconds}
          isPublic={isPublic} setIsPublic={setIsPublic}
          isAnonymous={isAnonymous} setIsAnonymous={setIsAnonymous}
          handleSave={(localOnly?: boolean) => hookHandleSave(localOnly ?? isLocalOnly)}
          tags={tags} setTags={setTags}
          labelId={labelId} setLabelId={setLabelId}
          labels={profile?.labels || []}
          isLocalOnly={isLocalOnly}
          existingDocuments={documents}
          onSaveAsNew={handleSaveAsNewDocument}
          onSaveAsVersion={handleSaveAsVersion}
          effectiveSource={effectiveSource}
        />

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
              onSave={handleSave}
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
                  timerDuration={useWritingStore.getState().timerDuration}
                  setTimerDuration={v => useWritingStore.getState().setTimerDuration(v)}
                  wordGoal={useWritingStore.getState().wordGoal}
                  setWordGoal={v => useWritingStore.getState().setWordGoal(v)}
                  targetTime={useWritingStore.getState().targetTime}
                  setTargetTime={v => useWritingStore.getState().setTargetTime(v)}
                  countdown={flow.countdown}
                  userSessions={userSessions}
                  continueSession={handleContinueSession}
                  isLocalOnly={isLocalOnly}
                  setIsLocalOnly={setIsLocalOnly}
                  encryptionPassword={useWritingStore.getState().encryptionPassword || ''}
                  setEncryptionPassword={v => useWritingStore.getState().setEncryptionPassword(v)}
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
                  onContinueSession={handleContinueSession} 
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

        <FlowPulse />
      </>
    </motion.div>
  );
}

export function WritingPage({ user, profile }: WritingViewProps) {
  return <WritingPageContent user={user} profile={profile} />;
}
