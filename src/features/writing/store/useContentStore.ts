import { create } from 'zustand';
import { WordSnapshot } from './types';
import { countWords } from '../../../shared/utils/countWords';
import { useTimerStore } from './useTimerStore';

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
}

interface ContentState extends ContentStateData {
  setContent: (content: string) => void;
  setTitle: (title: string) => void;
  setPinnedThoughts: (thoughts: string[]) => void;
  setTags: (tags: string[]) => void;
  setLabelId: (labelId?: string) => void;
  setInitialWordCount: (count: number) => void;
  pushWpmHistory: (entry: { timestamp: number; wpm: number }) => void;
  recalcStats: () => void;
}

let _wordCalcRaf: number | null = null;
let _wordCalcIsScheduled = false; // [P-01] флаг для предотвращения нескольких setContent в очереди

export function clearWordCalcTimer() {
  if (_wordCalcRaf != null) cancelAnimationFrame(_wordCalcRaf);
  _wordCalcRaf = null;
  _wordCalcIsScheduled = false;
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', clearWordCalcTimer);
}

export const useContentStore = create<ContentState>((set, get) => ({
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  lastWordCount: 0, wpmHistory: [],
  tags: [], labelId: undefined,

  setContent: (content) => {
    set({ content });
    if (!_wordCalcIsScheduled) { // [P-01] создаём таймер только если нет запланированного
      _wordCalcIsScheduled = true;
      _wordCalcRaf = requestAnimationFrame(() => {
        _wordCalcIsScheduled = false;
        _wordCalcRaf = null;
        get().recalcStats();
      });
    }
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
      const timeDiffMins = (newest.timestamp - oldest.timestamp) / 60000;

      if (timeDiffMins > 0) {
        const rawWpm = Math.max(0, (newest.wordCount - oldest.wordCount) / timeDiffMins);
        currentWpm = Math.round(0.3 * rawWpm + 0.7 * state.wpm);
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
