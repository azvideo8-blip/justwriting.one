import { useEffect, useCallback, useRef } from 'react';
import { User } from 'firebase/auth';
import { WritingDraftService } from '../services/WritingDraftService';
import { LocalDraft } from '../../../shared/lib/localDb';
import { WritingSessionService } from '../services/WritingSessionService';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { useDraftAutosave } from './useDraftAutosave';
import { UserProfile } from '../../../types';
import { fetchLocalSessions as fetchLocalSessionsFromLoader, loadLocalSession as loadLocalSessionFromLoader } from '../services/LocalSessionLoader';
import { useOnlineStatus } from '../../../shared/hooks/useOnlineStatus';
import { buildSessionPayload, saveLocalOnly, saveToCloud } from '../utils/sessionPersistence';
import { TimerStatus, SessionType } from '../store/types';

export interface SessionStateSlice {
  title: string;
  content: string;
  pinnedThoughts: string[];
  tags: string[];
  sessionType: SessionType;
  activeSessionId: string | null;
  initialDuration: number;
  initialWordCount: number;
  sessionStartTime: number | null;
}

export interface TimerStateSlice {
  seconds: number;
  wpm: number;
  wordCount: number;
  status: TimerStatus;
  timeGoalReached: boolean;
  wordGoalReached: boolean;
}

export interface PersistenceActions {
  setContent: (content: string) => void;
  setTitle: (title: string) => void;
  setPinnedThoughts: (thoughts: string[]) => void;
  setActiveSessionId: (id: string | null) => void;
  setHasDraft: (has: boolean) => void;
  resetSession: () => void;
  finishSession: () => void;
  setStatus: (status: TimerStatus) => void;
  setInitialWordCount: (count: number) => void;
  setInitialDuration: (duration: number) => void;
}

export function useSessionPersistence(
  user: User | null,
  profile: UserProfile | null,
  sessionState: SessionStateSlice,
  timerState: TimerStateSlice,
  actions: PersistenceActions
) {
  const isOnline = useOnlineStatus();
  const userId = user?.uid ?? '';
  const { saveStatus, lastSavedAt } = useDraftAutosave(user, {
    title: sessionState.title,
    content: sessionState.content,
    pinnedThoughts: sessionState.pinnedThoughts,
    seconds: timerState.seconds,
    wpm: timerState.wpm,
    wordCount: timerState.wordCount,
    initialWordCount: sessionState.initialWordCount,
    sessionStartTime: sessionState.sessionStartTime,
    activeSessionId: sessionState.activeSessionId,
    status: timerState.status
  });

  useEffect(() => {
    if (isOnline) {
      WritingSessionService.syncPendingSessions(userId);
    }
  }, [isOnline, userId]);

  const sessionStateRef = useRef(sessionState);
  useEffect(() => {
    sessionStateRef.current = sessionState;
  }, [sessionState]);

  function applyDraftToStore(draft: LocalDraft) {
    useContentStore.setState({
      content: draft.content || '',
      title: draft.title || '',
      pinnedThoughts: draft.pinnedThoughts || [],
      initialWordCount: draft.initialWordCount || 0,
      wordCount: draft.wordCount || 0,
      tags: draft.tags || [],
      labelId: draft.labelId ?? undefined,
    });
    useTimerStore.setState({
      seconds: draft.seconds || 0,
      accumulatedDuration: draft.accumulatedDuration ?? 0,
      totalPauseSeconds: draft.totalPauseSeconds ?? 0,
    });
    useSessionMetaStore.setState({
      savedDocumentId: draft.savedDocumentId ?? null,
      sessionStartTime: draft.sessionStartTime ?? null,
    });
    useTimerStore.getState().setSessionStart();
    if (draft.activeSessionId) actions.setActiveSessionId(draft.activeSessionId);
  }

  const draftLoadedForRef = useRef<string | null>(null);
  const loadDraft = useCallback(async () => {
    if (draftLoadedForRef.current === userId) return;
    if (!userId) return;
    
    const draftToLoad = await WritingDraftService.loadDraft(userId);
    if (draftToLoad) {
      actions.setHasDraft(true);
      if (!useContentStore.getState().content) {
        applyDraftToStore(draftToLoad);
      }
      await WritingDraftService.clearLegacyDraft(userId);
    }
    draftLoadedForRef.current = userId;
  }, [userId, actions]);

  const restoreDraft = useCallback(async () => {
    if (!userId) return;
    const draftToLoad = await WritingDraftService.loadDraft(userId);
    if (!draftToLoad) { actions.setHasDraft(false); return; }
    applyDraftToStore(draftToLoad);
    actions.setHasDraft(false);
    await WritingDraftService.clearLegacyDraft(userId);
  }, [userId, actions]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  const handleSave = async (isLocalOnly: boolean) => {
    const contentState = useContentStore.getState();
    const timerState_ = useTimerStore.getState();
    const metaState = useSessionMetaStore.getState();
    const sessionData = await buildSessionPayload(
      {
        title: contentState.title,
        content: contentState.content,
        pinnedThoughts: contentState.pinnedThoughts,
        seconds: timerState_.seconds,
        wordCount: contentState.wordCount,
        wpm: contentState.wpm,
        tags: contentState.tags,
        sessionType: timerState_.sessionType,
        sessionStartTime: metaState.sessionStartTime,
        timeGoalReached: timerState_.timeGoalReached,
        wordGoalReached: timerState_.wordGoalReached,
      },
      profile,
      user,
      userId
    );

    if (isLocalOnly) {
      await saveLocalOnly(sessionData, userId);
      actions.setHasDraft(false);
      actions.finishSession();
      return;
    }

    try {
      const savedId = await saveToCloud(sessionData, sessionState.activeSessionId, isOnline, userId);
      if (savedId && !sessionState.activeSessionId) {
        actions.setActiveSessionId(savedId);
      }
      actions.setHasDraft(false);
      actions.finishSession();
    } catch (e) {
      console.error('[SessionPersistence] Save failed:', e);
      throw e;
    }
  };

  const handleCancel = async () => {
    await WritingDraftService.deleteDraft(userId);
    actions.setHasDraft(false);
    actions.resetSession();
    actions.setStatus('idle');
  };

  const fetchLocalSessions = useCallback(() => fetchLocalSessionsFromLoader(userId), [userId]);
  const loadLocalSession = useCallback((id: string) => loadLocalSessionFromLoader(id), []);

  return {
    saveStatus,
    lastSavedAt,
    isOnline,
    handleSave,
    handleCancel,
    fetchLocalSessions,
    loadLocalSession,
    loadDraft,
    restoreDraft
  };
}
