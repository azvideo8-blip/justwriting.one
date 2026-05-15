import React from 'react';
import { useWritingStore } from '../store/useWritingStore';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useSessionContinue } from './useSessionContinue';
import { useLifeLog, LifeLogDocument } from './useLifeLog';
import { useDocuments } from './useDocuments';
import { useSessionList } from './useSessionList';
import { StorageService } from '../services/StorageService';
import { LocalVersionService } from '../services/LocalVersionService';
import { useToast } from '../../../shared/components/Toast';
import { useLanguage } from '../../../core/i18n';
import { SaveData } from '../WritingFinishModal';
import { Session } from '../../../types';
import { GuestSessionReturn } from './useGuestWritingSession';
import { CloudSessionReturn } from './useCloudWritingSession';
import { cleanupDraftsAfterSave, reportKeystrokeStats } from '../utils/sessionActions';

export type AnySessionReturn = GuestSessionReturn | CloudSessionReturn;

interface UseWritingActionsParams {
  session: AnySessionReturn;
  flow: {
    setSetupMode: (m: string | null) => void;
    setShowCancelConfirm: (v: boolean) => void;
  };
}

export function useWritingActions({ session, flow }: UseWritingActionsParams) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { setLifeLogVisible } = useWritingSettings();

  const isGuest = session.isGuest;
  const userId = session.userId;
  const sessionStatus = session.status;
  const setSessionStatus = session.setStatus;
  const { handleStart: hookHandleStart, fetchLocalSessions, loadLocalSession } = session;
  const savingRef = React.useRef(false);

  const { continueSession } = useSessionContinue({
    setSetupMode: flow.setSetupMode,
    setTags: session.setTags,
    loadLocalSession,
  });

  const { refresh: refreshDocuments } = useDocuments(userId, isGuest);
  const { refresh: refreshLifeLog } = useLifeLog(userId, isGuest);
  const { fetchAllSessions: fetchSessions } = useSessionList(userId, fetchLocalSessions, loadLocalSession);

  const handleContinueDocument = React.useCallback(async (doc: LifeLogDocument) => {
    if (sessionStatus === 'writing' || sessionStatus === 'paused') {
      flow.setShowCancelConfirm(true);
      return;
    }
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

      useWritingStore.getState().loadDraftIntoStore({
        content,
        title: doc.title,
        wordCount: doc.totalWords,
        savedDocumentId: localId,
        accumulatedDuration: doc.totalDuration,
      });

      useWritingStore.getState().setSessionStart();
      setSessionStatus('writing');
      setLifeLogVisible(false);
    } catch (err) {
      console.error('Failed to load document:', err);
      showToast(t('error_load_failed'), 'error');
    }
  }, [userId, setSessionStatus, setLifeLogVisible, showToast, t, sessionStatus, flow]);

  const handleContinueSession = React.useCallback(async (s: Session) => {
    try {
      await continueSession(s);
      flow.setSetupMode(null);
      setSessionStatus('writing');
      useWritingStore.getState().setSessionStart();
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
        sessionStartedAt: new Date(state.sessionStartTime ?? Date.now()),
      };

      const existingDocId = state.savedDocumentId;

      if (existingDocId) {
        await StorageService.saveVersion(userId, existingDocId, saveData);
      } else {
        const result = await StorageService.saveNew(userId, saveData);
        useWritingStore.getState().setSavedDocumentId(result.localId);
      }

      const docIdToSync = useWritingStore.getState().savedDocumentId;
      useWritingStore.getState().finishSession();

      await cleanupDraftsAfterSave(userId, isGuest, docIdToSync);

      await refreshDocuments();
      await refreshLifeLog();
    } catch (e) {
      console.error('Save failed:', e);
      throw e;
    } finally {
      savingRef.current = false;
    }
  }, [userId, isGuest, refreshDocuments, refreshLifeLog]);

  const handlePlay = React.useCallback(() => {
    if (sessionStatus === 'idle') {
      useWritingStore.getState().startFreeSession();
      hookHandleStart();
    } else if (sessionStatus === 'paused') {
      useWritingStore.getState().resumeSession();
    }
  }, [sessionStatus, hookHandleStart]);

  const handlePause = React.useCallback(() => {
    useWritingStore.getState().pauseSession();
  }, []);

  const handleNew = React.useCallback(async () => {
    const { wordCount, status } = useWritingStore.getState();
    if (wordCount > 0 && status !== 'idle') {
      flow.setShowCancelConfirm(true);
      return;
    }
    useWritingStore.getState().resetAndClear();
    await cleanupDraftsAfterSave(userId, isGuest, null);
  }, [flow, isGuest, userId]);

  const handleFinish = React.useCallback((keystrokeTrackerRef: React.RefObject<{ getStats: () => { kpm: number; ikiMedian: number; ikiCv: number; sampleSize: number; kpmWpmRatio?: number }; reset: () => void } | null>) => {
    const state = useWritingStore.getState();
    if (state.status === 'writing') {
      useWritingStore.getState().pauseSession();
    }
    const stats = keystrokeTrackerRef.current?.getStats();
    if (stats) {
      reportKeystrokeStats(stats, useWritingStore.getState().wpm, useWritingStore.getState().seconds);
    }
    keystrokeTrackerRef.current?.reset();
  }, []);

  const handleOpen = React.useCallback(async () => {
    await fetchSessions();
    setLifeLogVisible(true);
  }, [fetchSessions, setLifeLogVisible]);

  return {
    handleSave,
    handlePlay,
    handlePause,
    handleNew,
    handleFinish,
    handleOpen,
    handleContinueSession,
    handleContinueDocument,
    handleContinueSessionOrDoc,
    savingRef,
  };
}
