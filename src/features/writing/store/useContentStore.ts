import { create } from 'zustand';
import { WordSnapshot } from './types';
import { countWords } from '../../../shared/utils/countWords';
import { truncateText } from '../../../shared/utils/textLimits';
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
  // AUDIT-part2 2.1: часть логики undo, а не инфраструктура — поэтому в state
  // (видны devtools, сбрасываются тестами/HMR), в отличие от таймеров ниже.
  burstBaseline: HistoryEntry | null;
  isApplyingHistory: boolean;
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

// Таймеры — инфраструктура планирования, в состоянии им делать нечего
// (см. AUDIT-part2 2.1): переносили бы только лишние перерендеры.
let _burstDebounceTimer: ReturnType<typeof setTimeout> | null = null;
// AUDIT-M11: последний известный caret (обновляется setContent/recordSnapshot).
// Внутритиковая координата курсора — наблюдать её из devtools бессмысленно,
// поэтому тоже module scope.
let _lastCaret = 0;
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
  const baseline = get().burstBaseline;
  if (baseline != null) {
    const currentContent = get().content;
    if (baseline.content !== currentContent) {
      const past = [...get().past, baseline].slice(-MAX_HISTORY);
      useContentStore.setState({ past });
    }
    useContentStore.setState({ burstBaseline: null });
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
  burstBaseline: null,
  isApplyingHistory: false,

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

    if (get().isApplyingHistory) return;

    let baseline = get().burstBaseline;
    if (baseline == null) {
      baseline = { content: prevContent, caret: Math.min(caret, prevContent.length) };
    }

    const isNewlineBoundary = isBoundary || (newContent.length > prevContent.length && newContent.endsWith('\n'));

    if (isNewlineBoundary) {
      if (_burstDebounceTimer != null) {
        clearTimeout(_burstDebounceTimer);
        _burstDebounceTimer = null;
      }
      if (baseline.content !== newContent) {
        const past = [...get().past, baseline].slice(-MAX_HISTORY);
        set({ past, future: [] });
      }
      set({ burstBaseline: { content: newContent, caret } });
    } else {
      if (_burstDebounceTimer != null) {
        clearTimeout(_burstDebounceTimer);
      }
      set({ future: [], burstBaseline: baseline });
      _burstDebounceTimer = setTimeout(() => {
        flushBurst(get);
      }, 500);
    }
  },

  recordSnapshot: (caretPos) => {
    if (get().isApplyingHistory) return;
    flushBurst(get);
    const content = get().content;
    const caret = caretPos ?? content.length;
    _lastCaret = caret;
    const past = [...get().past, { content, caret }].slice(-MAX_HISTORY);
    set({ past, future: [] });
  },

  undo: () => {
    flushBurst(get);
    const { past, future, content } = get();
    if (past.length === 0) return null;

    const newPast = [...past];
    const previousEntry = newPast.pop()!;
    // AUDIT-M11: в future уходит РЕАЛЬНЫЙ caret (не content.length), иначе
    // последующий redo вернул бы курсор в конец текста.
    const currentEntry: HistoryEntry = { content, caret: _lastCaret };

    set({
      content: previousEntry.content,
      isApplyingHistory: true,
      past: newPast,
      future: [currentEntry, ...future].slice(0, MAX_HISTORY),
    });

    get().recalcStats();
    set({ isApplyingHistory: false });

    return previousEntry;
  },

  redo: () => {
    flushBurst(get);
    const { past, future, content } = get();
    if (future.length === 0) return null;

    const newFuture = [...future];
    const nextEntry = newFuture.shift()!;
    const currentEntry: HistoryEntry = { content, caret: _lastCaret };

    set({
      content: nextEntry.content,
      isApplyingHistory: true,
      past: [...past, currentEntry].slice(-MAX_HISTORY),
      future: newFuture,
    });

    get().recalcStats();
    set({ isApplyingHistory: false });

    return nextEntry;
  },

  resetHistory: () => {
    if (_burstDebounceTimer != null) {
      clearTimeout(_burstDebounceTimer);
      _burstDebounceTimer = null;
    }
    set({ past: [], future: [], burstBaseline: null });
  },

  recalcStats: () => {
    if (_wordCalcRaf != null) {
      cancelAnimationFrame(_wordCalcRaf);
      _wordCalcRaf = null;
    }
    // REQUIRED: the cancelled RAF callback is what normally clears this flag.
    // Leaving it set makes setContent skip scheduling forever (word count / WPM
    // freeze after the first undo/redo). Stats are computed synchronously below,
    // so any pending scheduled recalc is moot anyway.
    _wordCalcIsScheduled = false;
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
  setTags: (tags) => set({ tags: (tags ?? []).slice(0, 10).map(t => truncateText(String(t), 50)) }),
  setLabelId: (labelId) => set({ labelId }),
  setInitialWordCount: (initialWordCount) => set({ initialWordCount }),
  pushWpmHistory: (entry) => set(state => ({ wpmHistory: [...state.wpmHistory.slice(-119), entry] })),
}));
