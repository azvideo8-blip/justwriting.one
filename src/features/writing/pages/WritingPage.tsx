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

// Components
import { WritingHeader } from '../WritingHeader';
import { WritingEditor } from '../WritingEditor';
import { WritingFinishModal } from '../WritingFinishModal';
import { LifeLogPanel } from '../components/LifeLogPanel';
import { WritingSessionService } from '../services/WritingSessionService';
import { WritingDraftService } from '../services/WritingDraftService';
import { FlowPulse } from '../../../core/theme/FlowPulse';
import { BottomStats } from '../components/BottomStats';
import { Sidebar } from '../../navigation/components/Sidebar';

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
import { MobileWriteScreen } from '../components/MobileWriteScreen';
import { MobileHomeScreen } from '../components/MobileHomeScreen';
import { useLifeLog } from '../hooks/useLifeLog';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useToast } from '../../../shared/components/Toast';

import { useLocalStorage } from '../../../shared/hooks/useLocalStorage';
import { z } from 'zod';

interface WritingViewProps {
  user: User;
  profile: UserProfile | null;
}

function WritingPageContent({ user, profile }: WritingViewProps) {
  const { t } = useLanguage();
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
    handleStart: hookHandleStart, handleSave: hookHandleSave, handleCancel, resetSessionMetadata,
    isOnline,
    fetchLocalSessions,
    loadLocalSession,
    encryptionPassword, setEncryptionPassword,
    decryptSession,
    setActiveSessionId
  } = useWritingSession(user, profile);

  const { 
    isZenActive, zenModeEnabled, 
    editorWidth, 
    setStatus: setUIStatus,
    lifeLogEnabled,
    lifeLogVisible, setLifeLogVisible,
    lifeLogTab, setLifeLogTab,
    lifeLogPinned, setLifeLogPinned
  } = useWritingSettings();
  const showZen = isZenActive && zenModeEnabled;
  const { showToast } = useToast();
  const title = useWritingStore(s => s.title);
  const setTitle = useWritingStore(s => s.setTitle);
  
  const sessionStatus = useWritingStore(s => s.status);
  const setSessionStatus = useWritingStore(s => s.setStatus);
  const wordGoal = useWritingStore(s => s.wordGoal);
  const timerDuration = useWritingStore(s => s.timerDuration);
  const wordCount = useWritingStore(s => s.wordCount);

  const flow = useSessionFlow(
    hookHandleStart, sessionStatus, sessionType, setSessionType,
    targetTime, seconds, timeGoalReached, wordGoalReached
  );

  const handleFinish = () => setSessionStatus('finished');

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

  useEffect(() => {
    setUIStatus(sessionStatus);
  }, [sessionStatus, setUIStatus]);

  const { userSessions, loadingSessions, fetchAllSessions: fetchSessions } = useSessionList(
    user.uid,
    fetchLocalSessions,
    loadLocalSession
  );

  useEffect(() => {
    if (sessionToContinue) {
      continueSession(sessionToContinue);
      navigate(location.pathname, { state: {}, replace: true });
    }
  }, [sessionToContinue, continueSession, navigate, location.pathname]);

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

  const handleSave = React.useCallback(async () => {
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
      showToast(t('save_success'), 'success');
    } catch (e) {
      console.error('Save failed:', e);
      showToast(t('save_error'), 'error');
    } finally {
      savingRef.current = false;
    }
  }, [sessionStatus, wordCount, user, isPublic, isAnonymous, tags, profile, isOnline, showToast, t, fetchSessions]);

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
      await WritingDraftService.deleteDraft(user.uid);
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

  const LIFE_LOG_WIDTH = 380;
  const isMobile = layoutMode !== 'desktop';

  const { sessionGroups: lifeLogGroups, summary: lifeLogSummary } = useLifeLog(user.uid);
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
      />
      <FlowPulse />
    </>
  );

  if (isMobile) {
    if (sessionStatus === 'idle') {
      return (
        <>
          <MobileHomeScreen
            userId={user.uid}
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
          onStop={handleStop}
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
              onStop={handleStop}
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
            </div>
          </div>

          <div style={{ gridColumn: '2', gridRow: '3', overflow: 'hidden' }}>
            <BottomStats
              compact={isCompact}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
            />
          </div>

          <div style={{ gridColumn: '3', gridRow: '1 / 4', overflow: 'hidden' }}>
            <AnimatePresence>
              {lifeLogVisible && (
                <LifeLogPanel 
                  userId={user.uid} 
                  onContinueSession={handleContinueSession} 
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

        <FlowPulse />
      </>
    </motion.div>
  );
}

export function WritingPage(props: WritingViewProps) {
  return <WritingPageContent {...props} />;
}
