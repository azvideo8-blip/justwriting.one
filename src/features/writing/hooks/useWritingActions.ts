import React from 'react';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { resetAndClear, resetSession, loadDraftIntoStore } from '../store/storeActions';
import { useWritingSettings } from '../contexts/WritingSettingsContext';
import { LifeLogDocument } from '../types/lifeLog';
import { useLifeLog } from './useLifeLog';
import { useDocuments } from './useDocuments';
import { StorageService } from '../../../core/services/StorageService';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { useToast } from '../../../shared/components/Toast';
import { useLanguage } from '../../../shared/i18n';

function isLifeLogDocument(doc: Session | LifeLogDocument): doc is LifeLogDocument {
  return 'totalWords' in doc && 'totalDuration' in doc;
}
import { SaveData } from '../components/WritingFinishModal';
import { Session } from '../../../types';
import { GuestSessionReturn } from './useGuestWritingSession';
import { CloudSessionReturn } from './useCloudWritingSession';
import { cleanupDraftsAfterSave, reportKeystrokeStats } from '../utils/sessionActions';
import { SetupMode } from '../components/WritingSetup';
import { reportError } from '../../../shared/errors/reportError';
import { logger } from '../../../shared/errors/logger';

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
  const _setSessionStatus = session.setStatus;
  const { handleStart: hookHandleStart } = session;
  const savingRef = React.useRef(false);

  const { refresh: refreshDocuments } = useDocuments(userId, isGuest);
  const { refresh: refreshLifeLog } = useLifeLog(userId, isGuest);

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
          throw e;
        }
      }

      loadDraftIntoStore({
        content,
        title: doc.title,
        wordCount: doc.totalWords,
        savedDocumentId: localId,
        accumulatedDuration: doc.totalDuration,
      });

      // Reset goals so no false "goal reached" toast fires when loading a large doc
      useTimerStore.setState({ wordGoal: 0, timerDuration: 0, sessionStartWords: doc.totalWords });
      useContentStore.getState().setTags(doc.tags);
      useContentStore.getState().setLabelId(doc.labelId);
      flow.setSetupMode(null);
      // Stay idle — user clicks Start to begin writing (same as Archive continue)
      setLifeLogVisible(false);
    } catch (err) {
      reportError(err, { action: 'writingActions/continueDocument' });
      showToast(t('error_load_failed'), 'error');
    }
  }, [userId, setLifeLogVisible, showToast, t, flow]);

  const handleContinueSessionOrDoc = React.useCallback(async (sessionOrDoc: Session | LifeLogDocument) => {
    try {
      if (isLifeLogDocument(sessionOrDoc)) {
        await handleContinueDocument(sessionOrDoc);
      } else {
        // Archive passes an ArchiveSession (a Session carrying document storage
        // flags). Map it onto a LifeLogDocument and reuse the same continue path.
        const s = sessionOrDoc as Session & {
          _isLocal?: boolean;
          _linkedCloudId?: string;
          _hasCloudCopy?: boolean;
          _totalWords?: number;
          _totalDuration?: number;
          _sessionsCount?: number;
          _firstSessionAt?: number;
        };
        const isLocal = !!s._isLocal;
        const doc: LifeLogDocument = {
          localId: isLocal ? s.id : undefined,
          cloudId: isLocal ? s._linkedCloudId : s.id,
          title: s.title || '',
          totalWords: s._totalWords ?? s.wordCount ?? 0,
          totalDuration: s._totalDuration ?? s.duration ?? 0,
          currentVersion: 0,
          sessionsCount: s._sessionsCount ?? 0,
          firstSessionAt: s._firstSessionAt ?? s.sessionStartTime ?? 0,
          lastSessionAt: s.sessionStartTime ?? 0,
          tags: s.tags || [],
          labelId: s.labelId,
          storage: { local: isLocal, cloud: !!(s._hasCloudCopy || s._linkedCloudId || !isLocal) },
        };
        await handleContinueDocument(doc);
      }
    } catch (err) {
      logger.error('writingActions', 'Continue failed', { error: String(err) });
      reportError(err, { action: 'writingActions/continueSessionOrDoc' });
      showToast(t('error_continue_session'), 'error');
    }
  }, [handleContinueDocument, showToast, t]);

  const handleSave = React.useCallback(async (data: SaveData) => {
    if (savingRef.current) return null;
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
        const saveResult = await StorageService.saveVersion(userId, existingDocId, saveData);
        if (saveResult.forked) {
          showToast(t('sync_conflict_forked'), 'error');
        }
      } else {
        const result = await StorageService.saveNew(userId, saveData);
        useSessionMetaStore.getState().setSavedDocumentId(result.localId);
      }

      const docIdToSync = useSessionMetaStore.getState().savedDocumentId;

      await cleanupDraftsAfterSave(userId, isGuest, docIdToSync);

      await refreshDocuments();
      await refreshLifeLog();

      // Reset session AFTER cleanup succeeds — prevents content loss if cleanup throws
      resetSession();
      return docIdToSync ?? null;
    } catch (e) {
      reportError(e, { action: 'writingActions/save' });
      throw e;
    } finally {
      savingRef.current = false;
    }
  }, [userId, isGuest, refreshDocuments, refreshLifeLog, showToast, t]);

  const handlePlay = React.useCallback(() => {
    const currentStatus = useTimerStore.getState().status;
    if (currentStatus === 'idle') {
      useTimerStore.getState().startFreeSession(useContentStore.getState().wordCount);
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
    try {
      await cleanupDraftsAfterSave(userId, isGuest, null);
    } catch (e) {
      reportError(e, { action: 'writingActions/new' });
    }
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
    setLifeLogVisible(true);
  }, [setLifeLogVisible]);

  return React.useMemo(() => ({
    handleSave,
    handlePlay,
    handlePause,
    handleNew,
    handleFinish,
    handleOpen,
    handleContinueDocument,
    handleContinueSessionOrDoc,
    savingRef,
  }), [handleSave, handlePlay, handlePause, handleNew, handleFinish, handleOpen, handleContinueDocument, handleContinueSessionOrDoc]);
}
