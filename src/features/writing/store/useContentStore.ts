import { create } from 'zustand';
import { WordSnapshot } from './types';
import { countWords } from '../../../shared/utils/countWords';
import { useTimerStore } from './useTimerStore';

export interface HistoryEntry {
  content: string;
  caret: number;
}

export interface ContentStateData {
  content: string;
  title: string;
  pinnedThoughts: string[];
  wordCount: number;
  initialWordCount: number;
  wpm: number;
  wordSnapshots: WordSnapshot[];
  lastWordCount: number;
  wpmHistory: { timestamp: number; wpm: number }[];
  tags: string[];
  labelId?: string | undefined;
  past: HistoryEntry[];
  future: HistoryEntry[];
}

interface ContentState extends ContentStateData {
  setContent: (content: string, caretPos?: number, isBoundary?: boolean) => void;
  setTitle: (title: string) => void;
  setPinnedThoughts: (thoughts: string[]) => void;
  setTags: (tags: string[]) => void;
  setLabelId: (labelId?: string) => void;
  setInitialWordCount: (count: number) => void;
  pushWpmHistory: (entry: { timestamp: number; wpm: number }) => void;
  recalcStats: () => void;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
  resetHistory: () => void;
  recordSnapshot: (caretPos?: number) => void;
}

let _wordCalcRaf: number | null = null;
let _wordCalcIsScheduled = false; // [P-01] флаг для предотвращения нескольких setContent в очереди

let _isApplyingHistory = false;
let _burstDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let _burstBaseline: HistoryEntry | null = null;
const MAX_HISTORY = 100;

export function clearWordCalcTimer() {
  if (_wordCalcRaf != null) cancelAnimationFrame(_wordCalcRaf);
  _wordCalcRaf = null;
  _wordCalcIsScheduled = false;
}

function flushBurst(get: () => ContentStateData) {
  if (_burstDebounceTimer != null) {
    clearTimeout(_burstDebounceTimer);
    _burstDebounceTimer = null;
  }
  if (_burstBaseline != null) {
    const currentContent = get().content;
    if (_burstBaseline.content !== currentContent) {
      const past = [...get().past, _burstBaseline].slice(-MAX_HISTORY);
      useContentStore.setState({ past });
    }
    _burstBaseline = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', clearWordCalcTimer);
}

export const useContentStore = create<ContentState>((set, get) => ({
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  lastWordCount: 0, wpmHistory: [],
  tags: [], labelId: undefined,
  past: [], future: [],

  setContent: (newContent, caretPos, isBoundary) => {
    const prevContent = get().content;
    const caret = caretPos ?? newContent.length;

    set({ content: newContent });

    if (!_wordCalcIsScheduled) {
      _wordCalcIsScheduled = true;
      _wordCalcRaf = requestAnimationFrame(() => {
        _wordCalcIsScheduled = false;
        _wordCalcRaf = null;
        get().recalcStats();
      });
    }

    if (_isApplyingHistory) return;

    if (_burstBaseline == null) {
      _burstBaseline = { content: prevContent, caret: Math.min(caret, prevContent.length) };
    }

    const isNewlineBoundary = isBoundary || (newContent.length > prevContent.length && newContent.endsWith('\n'));

    if (isNewlineBoundary) {
      if (_burstDebounceTimer != null) {
        clearTimeout(_burstDebounceTimer);
        _burstDebounceTimer = null;
      }
      if (_burstBaseline !== null && _burstBaseline.content !== newContent) {
        const past = [...get().past, _burstBaseline].slice(-MAX_HISTORY);
        set({ past, future: [] });
      }
      _burstBaseline = { content: newContent, caret };
    } else {
      if (_burstDebounceTimer != null) {
        clearTimeout(_burstDebounceTimer);
      }
      set({ future: [] });
      _burstDebounceTimer = setTimeout(() => {
        flushBurst(get);
      }, 500);
    }
  },

  recordSnapshot: (caretPos) => {
    if (_isApplyingHistory) return;
    flushBurst(get);
    const content = get().content;
    const caret = caretPos ?? content.length;
    const past = [...get().past, { content, caret }].slice(-MAX_HISTORY);
    set({ past, future: [] });
  },

  undo: () => {
    flushBurst(get);
    const { past, future, content } = get();
    if (past.length === 0) return null;

    const newPast = [...past];
    const previousEntry = newPast.pop()!;
    const currentEntry: HistoryEntry = { content, caret: content.length };

    _isApplyingHistory = true;
    set({
      content: previousEntry.content,
      past: newPast,
      future: [currentEntry, ...future].slice(0, MAX_HISTORY),
    });

    get().recalcStats();
    _isApplyingHistory = false;

    return previousEntry;
  },

  redo: () => {
    flushBurst(get);
    const { past, future, content } = get();
    if (future.length === 0) return null;

    const newFuture = [...future];
    const nextEntry = newFuture.shift()!;
    const currentEntry: HistoryEntry = { content, caret: content.length };

    _isApplyingHistory = true;
    set({
      content: nextEntry.content,
      past: [...past, currentEntry].slice(-MAX_HISTORY),
      future: newFuture,
    });

    get().recalcStats();
    _isApplyingHistory = false;

    return nextEntry;
  },

  resetHistory: () => {
    if (_burstDebounceTimer != null) {
      clearTimeout(_burstDebounceTimer);
      _burstDebounceTimer = null;
    }
    _burstBaseline = null;
    set({ past: [], future: [] });
  },

  recalcStats: () => {
    if (_wordCalcRaf != null) {
      cancelAnimationFrame(_wordCalcRaf);
      _wordCalcRaf = null;
    }
    const state = get();
    const content = state.content;
    if (!content) {
      set({
        wordCount: 0,
        lastWordCount: 0,
        wordSnapshots: [],
        wpm: 0,
      });
      return;
    }

    const timerState = useTimerStore.getState();
    const words = countWords(content);
    const now = Date.now();

    const newSnapshots = [...state.wordSnapshots, { timestamp: now, wordCount: words }]
      .filter(snap => now - snap.timestamp <= 60000);

    let currentWpm = state.wpm;
    if (timerState.status === 'writing' && newSnapshots.length > 1) {
      const oldest = newSnapshots[0];
      const newest = newSnapshots[newSnapshots.length - 1];
      if (oldest && newest) {
        const timeDiffMins = (newest.timestamp - oldest.timestamp) / 60000;

        if (timeDiffMins > 0) {
          const rawWpm = Math.max(0, (newest.wordCount - oldest.wordCount) / timeDiffMins);
          currentWpm = Math.round(0.3 * rawWpm + 0.7 * state.wpm);
        }
      }
    }

    const history = Array.isArray(state.wpmHistory) ? state.wpmHistory : [];
    const lastHistoryEntry = history.at(-1);
    if (currentWpm > 0 && (lastHistoryEntry == null || now - lastHistoryEntry.timestamp >= 30_000)) {
      get().pushWpmHistory({ timestamp: now, wpm: currentWpm });
    }

    set({
      wordCount: words,
      lastWordCount: words,
      wordSnapshots: newSnapshots,
      wpm: currentWpm,
    });
  },

  setTitle: (title) => set({ title }),
  setPinnedThoughts: (pinnedThoughts) => set({ pinnedThoughts }),
  setTags: (tags) => set({ tags: (tags ?? []).slice(0, 10).map(t => String(t).slice(0, 50)) }),
  setLabelId: (labelId) => set({ labelId }),
  setInitialWordCount: (initialWordCount) => set({ initialWordCount }),
  pushWpmHistory: (entry) => set(state => ({ wpmHistory: [...state.wpmHistory.slice(-119), entry] })),
}));
