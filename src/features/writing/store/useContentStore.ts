import { create } from 'zustand';
import { WordSnapshot } from './types';
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
}

let _wordCalcTimer: ReturnType<typeof setTimeout> | null = null;

export function clearWordCalcTimer() {
  if (_wordCalcTimer) clearTimeout(_wordCalcTimer);
  _wordCalcTimer = null;
}

function computeWordStats(content: string) {
  const contentState = useContentStore.getState();
  const timerState = useTimerStore.getState();
  _wordCalcTimer = null;
  const words = content.trim().split(/\s+/).filter(x => x.length > 0).length;
  const now = Date.now();

  const newSnapshots = [...contentState.wordSnapshots, { timestamp: now, wordCount: words }]
    .filter(snap => now - snap.timestamp <= 60000);

  let currentWpm = contentState.wpm;
  if (timerState.status === 'writing' && newSnapshots.length > 1) {
    const oldest = newSnapshots[0];
    const newest = newSnapshots[newSnapshots.length - 1];
    const timeDiffMins = (newest.timestamp - oldest.timestamp) / 60000;

    if (timeDiffMins > 0) {
      const rawWpm = Math.max(0, (newest.wordCount - oldest.wordCount) / timeDiffMins);
      const alpha = 0.3;
      currentWpm = Math.round(alpha * rawWpm + (1 - alpha) * contentState.wpm);
    }
  }

  const sessionWords = words - timerState.sessionStartWords;
  const wordGoalReached = timerState.wordGoal > 0 && sessionWords >= timerState.wordGoal;

  const history = contentState.wpmHistory;
  const lastHistoryEntry = history[history.length - 1];
  if (currentWpm > 0 && (!lastHistoryEntry || now - lastHistoryEntry.timestamp >= 30_000)) {
    useContentStore.getState().pushWpmHistory({ timestamp: now, wpm: currentWpm });
  }

  useContentStore.setState({
    wordCount: words,
    lastWordCount: words,
    wordSnapshots: newSnapshots,
    wpm: currentWpm,
  });

  useTimerStore.setState({ wordGoalReached });
}

export const useContentStore = create<ContentState>((set) => ({
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  lastWordCount: 0, wpmHistory: [],
  tags: [], labelId: undefined,

  setContent: (content) => {
    set(() => {
      if (_wordCalcTimer) clearTimeout(_wordCalcTimer);
      _wordCalcTimer = setTimeout(() => computeWordStats(content), 100);
      return { content };
    });
  },

  setTitle: (title) => set({ title }),
  setPinnedThoughts: (pinnedThoughts) => set({ pinnedThoughts }),
  setTags: (tags) => set({ tags }),
  setLabelId: (labelId) => set({ labelId }),
  setInitialWordCount: (initialWordCount) => set({ initialWordCount }),
  pushWpmHistory: (entry) => set(state => ({ wpmHistory: [...state.wpmHistory.slice(-119), entry] })),
}));
