import React, { createContext, useContext, useRef, useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { UserProfile, Session } from '../../../types';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTimerStore } from '../store/useTimerStore';

import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { SyncService } from '../../../core/services/SyncService';
import { useSessionFlow } from '../hooks/useSessionFlow';
import { useWritingActions, AnySessionReturn } from '../hooks/useWritingActions';
import { useWritingKeyboard } from '../hooks/useWritingKeyboard';
import { useLifeLog } from '../hooks/useLifeLog';
import { useStreak } from '../hooks/useStreak';
import { KeystrokeTracker, KeystrokeStats } from '../utils/keystrokeTracker';
import { useLayoutMode } from '../../../shared/hooks/useLayoutMode';
import { useSettings } from '../../../core/settings/SettingsContext';
import { SetupMode } from '../components/WritingSetup';
import type { SessionGroup, DailySummary, LifeLogDocument } from '../types/lifeLog';
import { reportError } from '../../../shared/errors/reportError';

export interface WritingSessionContextValue {
  session: AnySessionReturn;
  profile: UserProfile | null;
  user: User | null;
  flow: {
    setupMode: SetupMode;
    setSetupMode: (mode: SetupMode) => void;
    countdown: number | null;
    startCountdown: (type: 'stopwatch' | 'timer' | 'words' | 'finish-by') => void;
    goalToastVisible: boolean;
    goalToastType: 'time' | 'words' | null;
    sessionStartFlash: boolean;
    totalDurationForDeadline: number | null;
    showCancelConfirm: boolean;
    setShowCancelConfirm: (v: boolean) => void;
  };
  actions: {
    handleSave: (data: import('../components/WritingFinishModal').SaveData) => Promise<void>;
    handlePlay: () => void;
    handlePause: () => void;
    handleNew: () => Promise<void>;
    handleFinish: (keystrokeTrackerRef: React.RefObject<{ getStats: () => { kpm: number; ikiMedian: number; ikiCv: number; sampleSize: number; kpmWpmRatio?: number } | null; reset: () => void } | null>) => void;
    handleOpen: () => Promise<void>;
    handleContinueDocument: (doc: LifeLogDocument) => Promise<void>;
    handleContinueSessionOrDoc: (sessionOrDoc: Session | LifeLogDocument) => Promise<void>;
    savingRef: React.MutableRefObject<boolean>;
  };
  lifeLogGroups: SessionGroup[];
  lifeLogSummary: DailySummary;
  refreshLifeLog: () => Promise<void>;
  streakDays: number;
  streakForModal: number;
  isFinishModalOpen: boolean;
  setIsFinishModalOpen: (v: boolean) => void;
  isShortcutsModalOpen: boolean;
  setIsShortcutsModalOpen: (v: boolean) => void;
  devKpmStats: KeystrokeStats | null;
  keystrokeTrackerRef: React.MutableRefObject<KeystrokeTracker>;
  handlePlayRef: React.MutableRefObject<() => void>;
  handlePauseRef: React.MutableRefObject<() => void>;
  isMobile: boolean;
  showZen: boolean;
  onFinishClick: () => void;
  sessionToContinue: Session | null;
  continueRef: React.MutableRefObject<boolean>;
  savedDocumentId: string | null;
}

const WritingSessionContext = createContext<WritingSessionContextValue | null>(null);

export function useWritingSessionContext() {
  const ctx = useContext(WritingSessionContext);
  if (!ctx) throw new Error('useWritingSessionContext must be used inside WritingSessionProvider');
  return ctx;
}

export function WritingSessionProvider({
  session,
  profile,
  user,
  children,
}: {
  session: AnySessionReturn;
  profile: UserProfile | null;
  user: User | null;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const sessionToContinue = (location.state as { sessionToContinue?: Session | null } | null)?.sessionToContinue || null;
  const isGuest = session.isGuest;
  const userId = session.userId;

  const timeGoalReached = useTimerStore(s => s.timeGoalReached);
  const wordGoalReached = useTimerStore(s => s.wordGoalReached);

  const sessionStatus = session.status;
  const savedDocumentId = useSessionMetaStore(s => s.savedDocumentId);

  const {
    targetTime,
    handleStart: hookHandleStart,
  } = session;

  const {
    isZenActive,
    zenModeEnabled,
    setStatus: setUIStatus,
    setLifeLogVisible,
    setLifeLogTab,
  } = useWritingSettings();
  const isBrowserOnline = useOnlineStatus();

  useEffect(() => {
    if (isBrowserOnline && !isGuest) {
      SyncService.syncPending(userId).catch(e => reportError(e, { action: 'sync_pending' }));
    }
  }, [isBrowserOnline, isGuest, userId]);

  const showZen = isZenActive && zenModeEnabled;

  const flow = useSessionFlow(
    hookHandleStart,
    sessionStatus,
    session.sessionType,
    session.setSessionType,
    targetTime,
    session.seconds,
    timeGoalReached,
    wordGoalReached
  );

  const actions = useWritingActions({ session, flow });

  const { handlePlay, handlePause } = actions;
  const handlePlayRef = React.useRef(handlePlay);
  const handlePauseRef = React.useRef(handlePause);

  useEffect(() => {
    handlePlayRef.current = handlePlay;
    handlePauseRef.current = handlePause;
  }, [handlePlay, handlePause]);

  const handleFinishRef = React.useRef<(() => void) | null>(null);
  const toggleShortcutsRef = React.useRef<(() => void) | null>(null);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);

  useWritingKeyboard({ sessionStatus, handlePlayRef, handlePauseRef, handleFinishRef, toggleShortcutsRef });

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
      void navigate(location.pathname, { state: {}, replace: true });
      void actions.handleContinueSessionOrDoc(sessionToContinue);
    }
  }, [sessionToContinue, actions, navigate, location.pathname]);

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
    actions.handleFinish(keystrokeTrackerRef);
    setIsFinishModalOpen(true);
  }, [actions]);

  useEffect(() => {
    handleFinishRef.current = onFinishClick;
  }, [onFinishClick]);

  const toggleShortcuts = React.useCallback(() => {
    setIsShortcutsModalOpen(v => !v);
  }, []);

  useEffect(() => {
    toggleShortcutsRef.current = toggleShortcuts;
  }, [toggleShortcuts]);

  const isMobile = useLayoutMode().layoutMode !== 'desktop';

  const { registerOpenOverride } = useSettings();
  useEffect(() => {
    if (isMobile) return;
    registerOpenOverride(() => {
      setLifeLogTab('settings');
      setLifeLogVisible(true);
    });
    return () => registerOpenOverride(null);
  }, [isMobile, registerOpenOverride, setLifeLogTab, setLifeLogVisible]);

  const value = React.useMemo(() => ({
    session,
    profile,
    user,
    flow,
    actions,
    lifeLogGroups,
    lifeLogSummary,
    refreshLifeLog,
    streakDays,
    streakForModal,
    isFinishModalOpen,
    setIsFinishModalOpen,
    isShortcutsModalOpen,
    setIsShortcutsModalOpen,
    devKpmStats,
    keystrokeTrackerRef,
    handlePlayRef,
    handlePauseRef,
    isMobile,
    showZen,
    onFinishClick,
    sessionToContinue,
    continueRef,
    savedDocumentId,
  }), [
    session,
    profile,
    user,
    flow,
    actions,
    lifeLogGroups,
    lifeLogSummary,
    refreshLifeLog,
    streakDays,
    streakForModal,
    isFinishModalOpen,
    isShortcutsModalOpen,
    devKpmStats,
    isMobile,
    showZen,
    onFinishClick,
    sessionToContinue,
    savedDocumentId,
  ]);

  return (
    <WritingSessionContext.Provider value={value}>
      {children}
    </WritingSessionContext.Provider>
  );
}
