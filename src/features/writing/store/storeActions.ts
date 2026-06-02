import { useContentStore, clearWordCalcTimer } from './useContentStore';
import { useTimerStore } from './useTimerStore';
import { useSessionMetaStore } from './useSessionMetaStore';
import { TimerStatus, SessionType } from './types';
import type { ContentStateData } from './useContentStore';
import type { TimerStateData } from './useTimerStore';
import type { SessionMetaStateData } from './useSessionMetaStore';

export function getContentState() { return useContentStore.getState(); }
export function getTimerState() { return useTimerStore.getState(); }
export function setTimerPartial(partial: Parameters<typeof useTimerStore.setState>[0]) {
  return useTimerStore.setState(partial);
}

const createContentDefaults = () => ({
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  lastWordCount: 0, wpmHistory: [],
  tags: [], labelId: undefined,
});

const TIMER_DEFAULTS = {
  seconds: 0, sessionStartSeconds: 0,
  status: 'idle' as TimerStatus,
  _startWallMs: null as number | null, _accumulatedMs: 0,
  sessionStartWallMs: null as number | null, sessionStartAccMs: 0,
  timeGoalReached: false, wordGoalReached: false,
  overtimeSeconds: 0, sessionStartWords: 0,
  accumulatedDuration: 0, totalPauseSeconds: 0, _pauseWallStart: null as number | null,
  initialDuration: 0, sessionType: 'free' as SessionType,
};

const META_DEFAULTS = {
  activeSessionId: null, savedDocumentId: null, sessionStartTime: null as number | null,
};

function resetSession() {
  clearWordCalcTimer();
  useContentStore.setState(createContentDefaults());
  useTimerStore.setState(TIMER_DEFAULTS);
  useSessionMetaStore.setState(META_DEFAULTS);
}

export { resetSession, resetSession as resetAndClear };

export function loadDraftIntoStore(draft: {
  content: string; title: string; wordCount: number;
  savedDocumentId?: string | undefined; accumulatedDuration?: number | undefined;
}) {
  useContentStore.setState({
    content: draft.content,
    title: draft.title,
    wordCount: draft.wordCount,
    lastWordCount: draft.wordCount,
    wpm: 0,
    wordSnapshots: [],
  });
  useTimerStore.setState({
    _startWallMs: null,
    _accumulatedMs: 0,
    status: 'idle',
    timeGoalReached: false,
    wordGoalReached: false,
    accumulatedDuration: draft.accumulatedDuration ?? 0,
  });
  useSessionMetaStore.setState({
    savedDocumentId: draft.savedDocumentId ?? null,
  });
}

export function resetAllSessionMetadata() {
  useContentStore.setState({
    initialWordCount: 0,
    tags: [],
    labelId: undefined,
  });
  useTimerStore.setState({
    initialDuration: 0,
  });
  useSessionMetaStore.getState().resetSessionMetadata();
}

export function setSessionConfig(config: Record<string, unknown>) {
  const contentKeys = new Set<keyof ContentStateData>(['content', 'title', 'pinnedThoughts', 'wordCount',
    'initialWordCount', 'wpm', 'wordSnapshots', 'lastWordCount', 'wpmHistory', 'tags', 'labelId']);
  const timerKeys = new Set<keyof TimerStateData>(['status', 'seconds', 'sessionStartSeconds', '_startWallMs', '_accumulatedMs', 'sessionStartWallMs', 'sessionStartAccMs', 'sessionStartWords',
    'timerDuration', 'wordGoal', 'targetTime', 'timeGoalReached', 'wordGoalReached',
    'overtimeSeconds', 'accumulatedDuration', 'totalPauseSeconds', '_pauseWallStart',
    'sessionType', 'initialDuration']);
  const metaKeys = new Set<keyof SessionMetaStateData>(['activeSessionId', 'savedDocumentId', 'sessionStartTime']);

  if (import.meta.env.DEV) {
    const allKnown = new Set<string>([...contentKeys, ...timerKeys, ...metaKeys]);
    const unknown = Object.keys(config).filter(k => !allKnown.has(k));
    if (unknown.length > 0) {
      console.warn('[setSessionConfig] Unknown keys dropped:', unknown);
    }
  }

  const contentPart: Partial<ContentStateData> = {};
  const timerPart: Partial<TimerStateData> = {};
  const metaPart: Partial<SessionMetaStateData> = {};

  for (const [key, value] of Object.entries(config)) {
    if (contentKeys.has(key as keyof ContentStateData)) (contentPart as Record<string, unknown>)[key] = value;
    else if (timerKeys.has(key as keyof TimerStateData)) (timerPart as Record<string, unknown>)[key] = value;
    else if (metaKeys.has(key as keyof SessionMetaStateData)) (metaPart as Record<string, unknown>)[key] = value;
  }

  if (Object.keys(contentPart).length > 0) {
    if (contentPart.pinnedThoughts && !Array.isArray(contentPart.pinnedThoughts)) contentPart.pinnedThoughts = [];
    if (contentPart.tags && !Array.isArray(contentPart.tags)) contentPart.tags = [];
    if (Array.isArray(contentPart.tags)) contentPart.tags = contentPart.tags.slice(0, 10).map(t => String(t).slice(0, 50));
    useContentStore.setState(contentPart);
  }
  if (Object.keys(timerPart).length > 0) useTimerStore.setState(timerPart);
  if (Object.keys(metaPart).length > 0) useSessionMetaStore.setState(metaPart);
}

// wordGoalReached is now computed inside checkGoals() in useTimerStore
// to avoid cross-store subscription side-effects at module level.
