import React from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { resetAndClear, finishSession, loadDraftIntoStore } from '../store/storeActions';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { useSessionContinue } from './useSessionContinue';
import { LifeLogDocument } from '../types/lifeLog';
import { useLifeLog } from './useLifeLog';
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
import { SetupMode } from '../WritingSetup';
import { reportError } from '../../../core/errors/reportError';

export type AnySessionReturn = GuestSessionReturn | CloudSessionReturn;

interface UseWritingActionsParams {
  session: AnySessionReturn;
  flow: {
    setSetupMode: (m: SetupMode | null) => void;
    setShowCancelConfirm: (v: boolean) => void;
  };
}

export function useWritingActions({ session, flow }: UseWritingActionsParams) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { setLifeLogVisible } = useWritingSettings();

  const isGuest = session.isGuest;
  const userId = session.userId;
  const setSessionStatus = session.setStatus;
  const { handleStart: hookHandleStart, fetchLocalSessions, loadLocalSession } = session;
  const savingRef = React.useRef(false);

  const { continueSession } = useSessionContinue({
    setSetupMode: flow.setSetupMode,
    setTags: session.setTags,
    loadLocalSession,
    userId,
  });

  const { refresh: refreshDocuments } = useDocuments(userId, isGuest);
  const { refresh: refreshLifeLog } = useLifeLog(userId, isGuest);
  const { fetchAllSessions: fetchSessions } = useSessionList(userId, fetchLocalSessions, loadLocalSession);

  const handleContinueDocument = React.useCallback(async (doc: LifeLogDocument) => {
    const currentStatus = useTimerStore.getState().status;
    if (currentStatus === 'writing' || currentStatus === 'paused') {
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
          reportError(e, { action: 'writingActions/importCloudDoc' });
        }
      }

      loadDraftIntoStore({
        content,
        title: doc.title,
        wordCount: doc.totalWords,
        savedDocumentId: localId,
        accumulatedDuration: doc.totalDuration,
      });

      useContentStore.getState().setTags(doc.tags || []);
      useContentStore.getState().setLabelId(doc.labelId);
      useTimerStore.getState().setSessionStart();
      useSessionMetaStore.getState().setSessionStartTime(Date.now());
      setSessionStatus('writing');
      setLifeLogVisible(false);
    } catch (err) {
      reportError(err, { action: 'writingActions/continueDocument' });
      showToast(t('error_load_failed'), 'error');
    }
  }, [userId, setSessionStatus, setLifeLogVisible, showToast, t, flow]);

  const handleContinueSession = React.useCallback(async (s: Session) => {
    try {
      await continueSession(s);
      flow.setSetupMode(null);
      setSessionStatus('writing');
      useTimerStore.getState().setSessionStart();
      useSessionMetaStore.getState().setSessionStartTime(Date.now());
    } catch (err) {
      reportError(err, { action: 'writingActions/continueSession' });
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
      useContentStore.getState().recalcStats();
      const contentState = useContentStore.getState();
      const timerState = useTimerStore.getState();
      const metaState = useSessionMetaStore.getState();
      const sessionSeconds = timerState.accumulatedDuration +
        Math.max(0, timerState.getSessionSeconds());

      const sessionNewWords = Math.max(0, contentState.wordCount - contentState.initialWordCount);

      const saveData = {
        title: data.title || contentState.title || '',
        content: contentState.content,
        wordCount: sessionNewWords,
        documentWordCount: contentState.wordCount,
        duration: sessionSeconds,
        wpm: contentState.wpm,
        isPublic: false,
        tags: data.tags,
        labelId: data.labelId,
        goalWords: timerState.wordGoal > 0 ? timerState.wordGoal : undefined,
        goalTime: timerState.timerDuration > 0 ? timerState.timerDuration : undefined,
        goalReached: timerState.wordGoal > 0 && sessionNewWords >= timerState.wordGoal,
        sessionStartedAt: new Date(metaState.sessionStartTime ?? Date.now()),
        mood: data.mood,
      };

      const existingDocId = metaState.savedDocumentId;

      if (existingDocId) {
        await StorageService.saveVersion(userId, existingDocId, saveData);
      } else {
        const result = await StorageService.saveNew(userId, saveData);
        useSessionMetaStore.getState().setSavedDocumentId(result.localId);
      }

      const docIdToSync = useSessionMetaStore.getState().savedDocumentId;
      finishSession();

      await cleanupDraftsAfterSave(userId, isGuest, docIdToSync);

      await refreshDocuments();
      await refreshLifeLog();
    } catch (e) {
      reportError(e, { action: 'writingActions/save' });
      throw e;
    } finally {
      savingRef.current = false;
    }
  }, [userId, isGuest, refreshDocuments, refreshLifeLog]);

  const handlePlay = React.useCallback(() => {
    const currentStatus = useTimerStore.getState().status;
    if (currentStatus === 'idle') {
      useTimerStore.getState().startFreeSession();
      hookHandleStart();
    } else if (currentStatus === 'paused') {
      useTimerStore.getState().resumeSession();
    }
  }, [hookHandleStart]);

  const handlePause = React.useCallback(() => {
    useTimerStore.getState().pauseSession();
  }, []);

  const handleNew = React.useCallback(async () => {
    const { wordCount } = useContentStore.getState();
    const { status } = useTimerStore.getState();
    if (wordCount > 0 && status !== 'idle') {
      flow.setShowCancelConfirm(true);
      return;
    }
    resetAndClear();
    await cleanupDraftsAfterSave(userId, isGuest, null);
  }, [flow, isGuest, userId]);

  const handleFinish = React.useCallback((keystrokeTrackerRef: React.RefObject<{ getStats: () => { kpm: number; ikiMedian: number; ikiCv: number; sampleSize: number; kpmWpmRatio?: number } | null; reset: () => void } | null>) => {
    const { status } = useTimerStore.getState();
    if (status === 'writing') {
      useTimerStore.getState().pauseSession();
    }
    const stats = keystrokeTrackerRef.current?.getStats();
    if (stats) {
      reportKeystrokeStats(stats, useContentStore.getState().wpm, useTimerStore.getState().getElapsedSeconds());
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
