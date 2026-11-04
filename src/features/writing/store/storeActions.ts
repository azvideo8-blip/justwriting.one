import { onDomainEvent } from '../../../core/events/domainEvents';
import { WritingDraftService } from '../services/WritingDraftService';
import { clearAllRescuePayloads, clearEditorTextOwner, markEditorTextOwner } from '../services/draftWriter';
import { useContentStore, clearWordCalcTimer } from './useContentStore';
import { useTimerStore } from './useTimerStore';
import { truncateText } from '../../../shared/utils/textLimits';
import { newDraftNonce, useSessionMetaStore } from './useSessionMetaStore';
import { TimerStatus, SessionType } from './types';
import type { ContentStateData } from './useContentStore';
import type { TimerStateData } from './useTimerStore';
import type { SessionMetaStateData } from './useSessionMetaStore';

const createContentDefaults = () => ({
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  lastWordCount: 0, wpmHistory: [],
  tags: [], labelId: undefined,
  ownerUid: null,
});

const TIMER_DEFAULTS: {
  seconds: number; sessionStartSeconds: number;
  status: TimerStatus;
  _startWallMs: number | null; _accumulatedMs: number;
  sessionStartEpochMs: number | null; sessionStartAccMs: number;
  timeGoalReached: boolean; wordGoalReached: boolean;
  overtimeSeconds: number; sessionStartWords: number;
  accumulatedDuration: number; totalPauseSeconds: number; _pauseWallStart: number | null;
  initialDuration: number; sessionType: SessionType;
} = {
  seconds: 0, sessionStartSeconds: 0,
  status: 'idle',
  _startWallMs: null, _accumulatedMs: 0,
  sessionStartEpochMs: null, sessionStartAccMs: 0,
  timeGoalReached: false, wordGoalReached: false,
  overtimeSeconds: 0, sessionStartWords: 0,
  accumulatedDuration: 0, totalPauseSeconds: 0, _pauseWallStart: null,
  initialDuration: 0, sessionType: 'free',
};

const META_DEFAULTS: {
  activeSessionId: null;
  savedDocumentId: null;
  sessionStartTime: number | null;
  loadedContent: null;
  loadedTitle: null;
} = {
  activeSessionId: null,
  savedDocumentId: null,
  sessionStartTime: null,
  loadedContent: null,
  loadedTitle: null,
};

function resetSession() {
  clearWordCalcTimer();
  // DW4-4: текста в редакторе больше нет — владельца у него тоже. Снимок,
  // ждущий спасения, живёт до своей записи (или до возобновления набора
  // владельцем): его чистит спасение и `markEditorTextOwnedBy`, не сброс.
  clearEditorTextOwner();
  useContentStore.setState(createContentDefaults());
  useContentStore.getState().resetHistory();
  useTimerStore.setState(TIMER_DEFAULTS);
  useSessionMetaStore.setState(META_DEFAULTS);
}

onDomainEvent(e => {
  if (e.type === 'draft.migrated') {
    // Черновик гостя уже лежит в базе аккаунта — остаётся отправить его копию
    // в облако. Ошибка здесь не критична: черновик на устройстве уже цел.
    void (async () => {
      try {
        const { getLocalDb } = await import('../../../core/storage/localDb');
        const db = await getLocalDb(e.userId);
        const draft = await db.get('drafts', e.userId);
        if (!draft) return;
        await WritingDraftService.saveDraftToCloud(draft); // намеренно: черновик уже сохранён локально
      } catch (err) { // намеренно: локальный черновик сохранён, ошибка синка не фатальна
        const { reportError } = await import('../../../shared/errors/reportError');
        reportError(err, { action: 'draft.migrated_saveDraftToCloud', userId: e.userId });
      }
    })();
    return;
  }
  if (e.type === 'account.reset') {
    // DW5-3.4: стирание аккаунта снимает и ждущие снимки спасения — иначе чужой
    // текст переживает «стереть всё с этого компьютера» и дописывается в базу,
    // когда её уже нет.
    clearAllRescuePayloads();
    resetSession();
  }
});

export { resetSession, resetSession as resetAndClear };

export function loadDraftIntoStore(draft: {
  content: string; title: string; wordCount: number;
  savedDocumentId?: string | undefined; accumulatedDuration?: number | undefined;
  initialDuration?: number | undefined;
}, ownerUid: string | null) {
  useContentStore.setState({
    content: draft.content,
    title: draft.title,
    wordCount: draft.wordCount,
    lastWordCount: draft.wordCount,
    initialWordCount: draft.wordCount,
    wpm: 0,
    wordSnapshots: [],
    ownerUid,
  });
  // DW5-3.4: зеркало редактора (чей текст стоит) — источник правила I3/I6 для
  // мутатора и писателей. Стор `ownerUid` без зеркала означало «владельца нет»,
  // и первый писатель подписывал подставленный текст собой.
  if (ownerUid) markEditorTextOwner(ownerUid);
  useContentStore.getState().resetHistory();
  useTimerStore.setState({
    _startWallMs: null,
    _accumulatedMs: 0,
    status: 'idle',
    timeGoalReached: false,
    wordGoalReached: false,
    accumulatedDuration: draft.accumulatedDuration ?? 0,
    // Reset timer config so stale goals don't fire on restored draft
    timerDuration: 0,
    timeGoalExplicit: false,
    wordGoal: 0,
    sessionType: 'free',
    targetTime: null,
    initialDuration: draft.initialDuration ?? (draft.savedDocumentId ? (draft.accumulatedDuration ?? 0) : 0),
    totalPauseSeconds: 0,
    seconds: 0,
    sessionStartSeconds: 0,
  });
  // R7Q-008: загрузка черновика — это новая заметка, даже если обе ещё без id.
  useSessionMetaStore.setState({
    savedDocumentId: draft.savedDocumentId ?? null,
    sessionStartTime: null,
    draftNonce: newDraftNonce(),
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
  const timerKeys = new Set<keyof TimerStateData>(['status', 'seconds', 'sessionStartSeconds', '_startWallMs', '_accumulatedMs', 'sessionStartEpochMs', 'sessionStartAccMs', 'sessionStartWords',
    'timerDuration', 'wordGoal', 'targetTime', 'timeGoalReached', 'wordGoalReached',
    'overtimeSeconds', 'accumulatedDuration', 'totalPauseSeconds', '_pauseWallStart',
    'sessionType', 'initialDuration']);
  const metaKeys = new Set<keyof SessionMetaStateData>(['activeSessionId', 'savedDocumentId', 'sessionStartTime', 'loadedContent', 'loadedTitle']);

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
    if (Array.isArray(contentPart.tags)) contentPart.tags = contentPart.tags.slice(0, 10).map(t => truncateText(String(t), 50));
    useContentStore.setState(contentPart);
  }
  if (Object.keys(timerPart).length > 0) useTimerStore.setState(timerPart);
  if (Object.keys(metaPart).length > 0) useSessionMetaStore.setState(metaPart);
}

// wordGoalReached is now computed inside checkGoals() in useTimerStore
// to avoid cross-store subscription side-effects at module level.

/**
 * Начало (или продолжение) сессии письма — один путь для первой буквы и для
 * диктовки (MF-1). `baselineWords` — сколько слов было до ввода, который
 * начинает сессию; без него берётся текущий счётчик стора.
 */
export function startWritingSession(baselineWords?: number) {
  const timer = useTimerStore.getState();
  const currentStatus = timer.status;
  const baseline = baselineWords ?? useContentStore.getState().wordCount;
  if (currentStatus === 'paused') timer.resumeSession();
  else timer.setStatus('writing');
  timer.setTimeGoalReached(false);
  timer.setWordGoalReached(false);
  if (!useSessionMetaStore.getState().sessionStartTime) {
    useContentStore.getState().setInitialWordCount(baseline);
    useSessionMetaStore.getState().setSessionStartTime(Date.now());
  }
  if (currentStatus === 'idle') {
    useTimerStore.setState({ _startWallMs: performance.now(), _accumulatedMs: 0, seconds: 0, sessionStartSeconds: 0 });
    useTimerStore.getState().setSessionStart(baseline);
  }
}
