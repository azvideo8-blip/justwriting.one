import { create } from 'zustand';

export type TimerStatus = 'idle' | 'writing' | 'paused' | 'finished';
export type SessionType = 'free' | 'stopwatch' | 'timer' | 'words' | 'finish-by';

interface WordSnapshot { timestamp: number; wordCount: number; }

interface WritingState {
  content: string;
  title: string;
  pinnedThoughts: string[];
  wordCount: number;
  initialWordCount: number;
  wpm: number;
  wordSnapshots: WordSnapshot[];
  lastWordCount: number;
  
  seconds: number;
  status: TimerStatus;
  sessionType: SessionType;
  timerDuration: number;
  targetTime: string | null;
  wordGoal: number;
  timeGoalReached: boolean;
  wordGoalReached: boolean;
  overtimeSeconds: number;
  sessionStartWords: number;
  sessionStartSeconds: number;
  accumulatedDuration: number;

  tags: string[];
  labelId?: string;
  initialDuration: number;
  activeSessionId: string | null;
  savedDocumentId: string | null;
  sessionStartTime: number | null;

  setContent: (content: string) => void;
  setTitle: (title: string) => void;
  setPinnedThoughts: (thoughts: string[]) => void;
  setStatus: (status: TimerStatus) => void;
  setInitialWordCount: (count: number) => void;
  setSessionConfig: (config: Partial<WritingState>) => void;
  setSessionStart: () => void;
  tick: () => void;
  resetSession: () => void;
  finishSession: () => void;

  setSessionType: (type: SessionType) => void;
  setTimerDuration: (duration: number) => void;
  setWordGoal: (goal: number) => void;
  setTargetTime: (time: string | null) => void;
  setTags: (tags: string[]) => void;
  setLabelId: (labelId?: string) => void;
  setInitialDuration: (duration: number) => void;
  setActiveSessionId: (id: string | null) => void;
  setSavedDocumentId: (id: string | null) => void;
  setSessionStartTime: (time: number | null) => void;
  setTimeGoalReached: (reached: boolean) => void;
  setWordGoalReached: (reached: boolean) => void;
  setAccumulatedDuration: (d: number) => void;
  resetSessionMetadata: () => void;
}

let _wordCalcTimer: ReturnType<typeof setTimeout> | null = null;

function computeWordStats(content: string) {
  const state = useWritingStore.getState();
  const words = content.trim().split(/\s+/).filter(x => x.length > 0).length;
  const now = Date.now();
  const wordsAdded = Math.max(0, words - state.lastWordCount);

  const newSnapshots = [...state.wordSnapshots, { timestamp: now, wordCount: words }]
    .filter(snap => now - snap.timestamp <= 60000);

  let currentWpm = state.wpm;
  if (state.status === 'writing' && newSnapshots.length > 1) {
    const oldest = newSnapshots[0];
    const newest = newSnapshots[newSnapshots.length - 1];
    const timeDiffMins = (newest.timestamp - oldest.timestamp) / 60000;

    if (timeDiffMins > 0 && wordsAdded > 0) {
      const rawWpm = Math.max(0, (newest.wordCount - oldest.wordCount) / timeDiffMins);
      const alpha = 0.3;
      currentWpm = Math.round(alpha * rawWpm + (1 - alpha) * state.wpm);
    }
  }

  const sessionWords = words - state.sessionStartWords;
  const wordGoalReached = state.wordGoal > 0 && sessionWords >= state.wordGoal;

  useWritingStore.setState({
    wordCount: words,
    lastWordCount: words,
    wordSnapshots: newSnapshots,
    wpm: currentWpm,
    wordGoalReached,
  });
}

export const useWritingStore = create<WritingState>((set) => ({
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  lastWordCount: 0,
  seconds: 0, status: 'idle', sessionType: 'free',
  timerDuration: 30 * 60, targetTime: null, wordGoal: 1000,
  timeGoalReached: false, wordGoalReached: false, overtimeSeconds: 0,
  sessionStartWords: 0, sessionStartSeconds: 0, accumulatedDuration: 0,

  tags: [], labelId: undefined,
  initialDuration: 0, activeSessionId: null, savedDocumentId: null, sessionStartTime: null,

  setContent: (content) => {
    set({ content });
    if (_wordCalcTimer) clearTimeout(_wordCalcTimer);
    _wordCalcTimer = setTimeout(() => computeWordStats(content), 100);
  },

  setTitle: (title) => set({ title }),
  setPinnedThoughts: (pinnedThoughts) => set({ pinnedThoughts }),
  setStatus: (status) => set({ status }),
  setInitialWordCount: (initialWordCount) => set({ initialWordCount }),
  setSessionConfig: (config) => set(config),
  setSessionStart: () => set((state) => ({
    sessionStartWords: state.wordCount,
    sessionStartSeconds: state.seconds,
  })),
  
  setSessionType: (sessionType) => set({ sessionType }),
  setTimerDuration: (timerDuration) => set((state) => {
    if (state.status !== 'idle' && state.timeGoalReached) {
      return {
        timerDuration,
        timeGoalReached: false,
        overtimeSeconds: 0,
        accumulatedDuration: state.accumulatedDuration + (state.seconds - state.sessionStartSeconds),
        sessionStartSeconds: state.seconds,
      };
    }
    return { timerDuration };
  }),
  setWordGoal: (wordGoal) => set((state) => {
    if (state.status !== 'idle' && state.wordGoalReached) {
      return {
        wordGoal,
        wordGoalReached: false,
        sessionStartWords: state.wordCount,
      };
    }
    return { wordGoal };
  }),
  setTargetTime: (targetTime) => set({ targetTime }),
  setTags: (tags) => set({ tags }),
  setLabelId: (labelId) => set({ labelId }),
  setInitialDuration: (initialDuration) => set({ initialDuration }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setSavedDocumentId: (savedDocumentId) => set({ savedDocumentId }),
  setSessionStartTime: (sessionStartTime) => set({ sessionStartTime }),
  setTimeGoalReached: (timeGoalReached) => set({ timeGoalReached }),
  setWordGoalReached: (wordGoalReached) => set({ wordGoalReached }),
  setAccumulatedDuration: (accumulatedDuration) => set({ accumulatedDuration }),
  
  resetSessionMetadata: () => set({
    initialWordCount: 0,
    initialDuration: 0,
    sessionStartTime: null,
    activeSessionId: null,
    savedDocumentId: null,
    tags: [],
    labelId: undefined,
  }),

  resetSession: () => set({
    content: '', title: '', pinnedThoughts: [],
    wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
    lastWordCount: 0,
    seconds: 0, status: 'idle', timeGoalReached: false, wordGoalReached: false,
    overtimeSeconds: 0, sessionStartWords: 0, sessionStartSeconds: 0, accumulatedDuration: 0,
    savedDocumentId: null, sessionStartTime: null,
    tags: [], labelId: undefined, initialDuration: 0, activeSessionId: null,
  }),

  finishSession: () => set({
    seconds: 0, status: 'idle', wpm: 0, wordSnapshots: [],
    lastWordCount: 0, timeGoalReached: false, wordGoalReached: false,
    overtimeSeconds: 0, sessionStartWords: 0, sessionStartSeconds: 0, accumulatedDuration: 0,
    activeSessionId: null, savedDocumentId: null, sessionStartTime: null,
    tags: [], labelId: undefined, initialDuration: 0, initialWordCount: 0,
  }),

  tick: () => set((state) => {
    if (state.status !== 'writing') return state;

    const newSeconds = state.seconds + 1;

    // Session delta — how long THIS session has been running:
    const sessionSeconds = newSeconds - state.sessionStartSeconds;
    let timeGoalReached = state.timeGoalReached;
    let overtimeSeconds = state.overtimeSeconds;

    if (state.sessionType === 'timer' && state.timerDuration > 0 && sessionSeconds >= state.timerDuration) {
      timeGoalReached = true;
    }
    if (state.targetTime) {
      const [hours, minutes] = state.targetTime.split(':').map(Number);
      const target = new Date(); target.setHours(hours, minutes, 0, 0);
      if (new Date() >= target) timeGoalReached = true;
    }

    // Count overtime seconds after goal reached
    if (timeGoalReached && state.sessionType === 'timer' && state.timerDuration > 0) {
      overtimeSeconds = sessionSeconds - state.timerDuration;
    }

    // Gradual WPM decay instead of hard drop to 0
    // Check when last word was added
    let currentWpm = state.wpm;
    if (state.wordSnapshots.length > 0) {
      const lastActive = state.wordSnapshots[state.wordSnapshots.length - 1].timestamp;
      const idleSeconds = (Date.now() - lastActive) / 1000;

      if (idleSeconds > 5) {
        // Decay 5% per second after 5s idle — smooth fade to zero
        // After ~60s idle WPM will be near 0
        currentWpm = Math.max(0, Math.round(state.wpm * 0.95));
      }
    }

    return { seconds: newSeconds, timeGoalReached, overtimeSeconds, wpm: currentWpm };
  }),
}));
