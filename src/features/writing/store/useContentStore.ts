import { create } from 'zustand';
import { WordSnapshot } from './types';
import { countWords } from '../../../shared/utils/countWords';
import { useTimerStore } from './useTimerStore';

interface ContentState {
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
  labelId?: string;

  setContent: (content: string) => void;
  setTitle: (title: string) => void;
  setPinnedThoughts: (thoughts: string[]) => void;
  setTags: (tags: string[]) => void;
  setLabelId: (labelId?: string) => void;
  setInitialWordCount: (count: number) => void;
  pushWpmHistory: (entry: { timestamp: number; wpm: number }) => void;
  recalcStats: () => void;
}

let _wordCalcTimer: ReturnType<typeof setTimeout> | null = null;

export function clearWordCalcTimer() {
  if (_wordCalcTimer) clearTimeout(_wordCalcTimer);
  _wordCalcTimer = null;
}

export const useContentStore = create<ContentState>((set, get) => ({
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  lastWordCount: 0, wpmHistory: [],
  tags: [], labelId: undefined,

  setContent: (content) => {
    if (_wordCalcTimer) clearTimeout(_wordCalcTimer);
    _wordCalcTimer = setTimeout(() => {
      set({ content });
      get().recalcStats();
    }, 100);
  },

  recalcStats: () => {
    const state = get();
    const content = state.content;
    if (!content) return;

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

    const sessionWords = words - timerState.sessionStartWords;
    const wordGoalReached = timerState.wordGoal > 0 && sessionWords >= timerState.wordGoal;

    const history = Array.isArray(state.wpmHistory) ? state.wpmHistory : [];
    const lastHistoryEntry = history[history.length - 1];
    if (currentWpm > 0 && (!lastHistoryEntry || now - lastHistoryEntry.timestamp >= 30_000)) {
      get().pushWpmHistory({ timestamp: now, wpm: currentWpm });
    }

    set({
      wordCount: words,
      lastWordCount: words,
      wordSnapshots: newSnapshots,
      wpm: currentWpm,
    });

    useTimerStore.setState({ wordGoalReached });
  },

  setTitle: (title) => set({ title }),
  setPinnedThoughts: (pinnedThoughts) => set({ pinnedThoughts }),
  setTags: (tags) => set({ tags: (tags ?? []).slice(0, 10).map(t => String(t).slice(0, 50)) }),
  setLabelId: (labelId) => set({ labelId }),
  setInitialWordCount: (initialWordCount) => set({ initialWordCount }),
  pushWpmHistory: (entry) => set(state => ({ wpmHistory: [...state.wpmHistory.slice(-119), entry] })),
}));
