import { useContentStore, clearWordCalcTimer, registerTimerBridge } from './useContentStore';
import { useTimerStore } from './useTimerStore';
import { useSessionMetaStore } from './useSessionMetaStore';
import { TimerStatus, SessionType } from './types';

export function getContentState() { return useContentStore.getState(); }
export function getTimerState() { return useTimerStore.getState(); }
export function setTimerPartial(partial: Parameters<typeof useTimerStore.setState>[0]) {
  return useTimerStore.setState(partial);
}

registerTimerBridge(
  () => {
    const s = useTimerStore.getState();
    return { status: s.status, sessionStartWords: s.sessionStartWords, wordGoal: s.wordGoal };
  },
  (partial) => useTimerStore.setState(partial as unknown as Parameters<typeof useTimerStore.setState>[0]),
);

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

export function resetAndClear() {
  clearWordCalcTimer();
  useContentStore.setState(createContentDefaults());
  useTimerStore.setState(TIMER_DEFAULTS);
  useSessionMetaStore.setState(META_DEFAULTS);
}

export function resetSession() {
  clearWordCalcTimer();
  useContentStore.setState(createContentDefaults());
  useTimerStore.setState(TIMER_DEFAULTS);
  useSessionMetaStore.setState(META_DEFAULTS);
}

export function finishSession() {
  clearWordCalcTimer();
  useContentStore.setState(createContentDefaults());
  useTimerStore.setState(TIMER_DEFAULTS);
  useSessionMetaStore.setState(META_DEFAULTS);
}

export function loadDraftIntoStore(draft: {
  content: string; title: string; wordCount: number;
  savedDocumentId?: string; accumulatedDuration?: number;
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
  const contentKeys = new Set(['content', 'title', 'pinnedThoughts', 'wordCount',
    'initialWordCount', 'wpm', 'wordSnapshots', 'lastWordCount', 'wpmHistory', 'tags', 'labelId']);
  const timerKeys = new Set(['status', 'seconds', 'sessionStartSeconds', '_startWallMs', '_accumulatedMs', 'sessionStartWallMs', 'sessionStartAccMs', 'sessionStartWords',
    'timerDuration', 'wordGoal', 'targetTime', 'timeGoalReached', 'wordGoalReached',
    'overtimeSeconds', 'accumulatedDuration', 'totalPauseSeconds', '_pauseWallStart',
    'sessionType', 'initialDuration']);
  const metaKeys = new Set(['activeSessionId', 'savedDocumentId', 'sessionStartTime']);

  const contentPart: Record<string, unknown> = {};
  const timerPart: Record<string, unknown> = {};
  const metaPart: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (contentKeys.has(key)) contentPart[key] = value;
    else if (timerKeys.has(key)) timerPart[key] = value;
    else if (metaKeys.has(key)) metaPart[key] = value;
  }

  if (Object.keys(contentPart).length > 0) {
    if (contentPart.pinnedThoughts && !Array.isArray(contentPart.pinnedThoughts)) contentPart.pinnedThoughts = [];
    if (contentPart.tags && !Array.isArray(contentPart.tags)) contentPart.tags = [];
    if (Array.isArray(contentPart.tags)) contentPart.tags = (contentPart.tags as string[]).slice(0, 10).map(t => String(t).slice(0, 50));
    useContentStore.setState(contentPart as Partial<ReturnType<typeof createContentDefaults>>);
  }
  if (Object.keys(timerPart).length > 0) useTimerStore.setState(timerPart as Partial<typeof TIMER_DEFAULTS>);
  if (Object.keys(metaPart).length > 0) useSessionMetaStore.setState(metaPart as Partial<typeof META_DEFAULTS>);
}
