import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { loadDraftIntoStore } from '../store/storeActions';

export interface DraftDataToApply {
  content?: string;
  title?: string;
  pinnedThoughts?: string[];
  seconds?: number;
  wpm?: number;
  wordCount?: number;
  initialWordCount?: number;
  activeSessionId?: string | null;
  sessionStartTime?: number | null;
  accumulatedDuration?: number;
  totalPauseSeconds?: number;
  savedDocumentId?: string | null;
  tags?: string[];
  labelId?: string;
}

export function applyDraftToStores(draft: DraftDataToApply) {
  loadDraftIntoStore({
    content: draft.content || '',
    title: draft.title || '',
    wordCount: draft.wordCount || 0,
    savedDocumentId: draft.savedDocumentId ?? undefined,
    accumulatedDuration: draft.accumulatedDuration ?? 0,
  });

  useContentStore.setState({
    pinnedThoughts: Array.isArray(draft.pinnedThoughts) ? draft.pinnedThoughts : [],
    tags: Array.isArray(draft.tags) ? draft.tags : [],
    labelId: draft.labelId ?? undefined,
    initialWordCount: draft.initialWordCount ?? 0,
  });

  useTimerStore.setState({
    seconds: draft.seconds ?? 0,
    accumulatedDuration: draft.accumulatedDuration ?? 0,
    totalPauseSeconds: draft.totalPauseSeconds ?? 0,
  });

  useSessionMetaStore.setState({
    savedDocumentId: draft.savedDocumentId ?? null,
    sessionStartTime: draft.sessionStartTime ?? null,
    activeSessionId: draft.activeSessionId ?? null,
  });

  useTimerStore.getState().setSessionStart();
}
