import { create } from 'zustand';

export type TimerStatus = 'idle' | 'writing' | 'paused' | 'finished';
export type SessionType = 'stopwatch' | 'timer' | 'words' | 'finish-by';

interface WordSnapshot { timestamp: number; wordCount: number; }

interface WritingState {
  content: string;
  title: string;
  pinnedThoughts: string[];
  wordCount: number;
  initialWordCount: number;
  wpm: number;
  wordSnapshots: WordSnapshot[];
  
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

  isPublic: boolean;
  isAnonymous: boolean;
  tags: string[];
  labelId?: string;
  initialDuration: number;
  activeSessionId: string | null;
  encryptionPassword?: string;
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

  setSessionType: (type: SessionType) => void;
  setTimerDuration: (duration: number) => void;
  setWordGoal: (goal: number) => void;
  setTargetTime: (time: string | null) => void;
  setIsPublic: (isPublic: boolean) => void;
  setIsAnonymous: (isAnonymous: boolean) => void;
  setTags: (tags: string[]) => void;
  setLabelId: (labelId?: string) => void;
  setInitialDuration: (duration: number) => void;
  setActiveSessionId: (id: string | null) => void;
  setEncryptionPassword: (password?: string) => void;
  setSessionStartTime: (time: number | null) => void;
  setTimeGoalReached: (reached: boolean) => void;
  setWordGoalReached: (reached: boolean) => void;
  resetSessionMetadata: () => void;
}

export const useWritingStore = create<WritingState>((set, get) => ({
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  seconds: 0, status: 'idle', sessionType: 'stopwatch',
  timerDuration: 15 * 60, targetTime: null, wordGoal: 500,
  timeGoalReached: false, wordGoalReached: false, overtimeSeconds: 0,
  sessionStartWords: 0, sessionStartSeconds: 0,

  isPublic: false, isAnonymous: false, tags: [], labelId: undefined,
  initialDuration: 0, activeSessionId: null, encryptionPassword: '', sessionStartTime: null,

  setContent: (content) => set((state) => {
    const words = content.trim().split(/\s+/).filter(x => x.length > 0).length;
    const now = Date.now();
    
    // Sliding Window WPM (Last 60s)
    const newSnapshots = [...state.wordSnapshots, { timestamp: now, wordCount: words }]
      .filter(snap => now - snap.timestamp <= 60000);
    
    let currentWpm = state.wpm;
    if (newSnapshots.length > 1 && state.status === 'writing') {
      const oldest = newSnapshots[0];
      const newest = newSnapshots[newSnapshots.length - 1];
      const timeDiffMins = (newest.timestamp - oldest.timestamp) / 60000;
      const wordsDiff = newest.wordCount - oldest.wordCount;
      if (timeDiffMins > 0) currentWpm = Math.round(wordsDiff / timeDiffMins);
    }

    // Word goal: compare session delta, not total
    const sessionWords = words - state.sessionStartWords;
    const wordGoalReached = state.sessionType === 'words' && sessionWords >= state.wordGoal;

    return { content, wordCount: words, wordSnapshots: newSnapshots, wpm: currentWpm, wordGoalReached };
  }),

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
  setTimerDuration: (timerDuration) => set({ timerDuration }),
  setWordGoal: (wordGoal) => set({ wordGoal }),
  setTargetTime: (targetTime) => set({ targetTime }),
  setIsPublic: (isPublic) => set({ isPublic }),
  setIsAnonymous: (isAnonymous) => set({ isAnonymous }),
  setTags: (tags) => set({ tags }),
  setLabelId: (labelId) => set({ labelId }),
  setInitialDuration: (initialDuration) => set({ initialDuration }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  setEncryptionPassword: (encryptionPassword) => set({ encryptionPassword }),
  setSessionStartTime: (sessionStartTime) => set({ sessionStartTime }),
  setTimeGoalReached: (timeGoalReached) => set({ timeGoalReached }),
  setWordGoalReached: (wordGoalReached) => set({ wordGoalReached }),
  
  resetSessionMetadata: () => set({
    initialWordCount: 0,
    initialDuration: 0,
    sessionStartTime: null,
    activeSessionId: null,
    tags: [],
    isPublic: false,
    isAnonymous: false,
    labelId: undefined,
    encryptionPassword: ''
  }),

  resetSession: () => set({
    content: '', title: '', pinnedThoughts: [],
    wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
    seconds: 0, status: 'idle', timeGoalReached: false, wordGoalReached: false,
    overtimeSeconds: 0, sessionStartWords: 0, sessionStartSeconds: 0
  }),

  tick: () => set((state) => {
    if (state.status !== 'writing') return state;

    const newSeconds = state.seconds + 1;

    // Session delta — how long THIS session has been running:
    const sessionSeconds = newSeconds - state.sessionStartSeconds;
    let timeGoalReached = state.timeGoalReached;
    let overtimeSeconds = state.overtimeSeconds;

    if (state.sessionType === 'timer' && sessionSeconds >= state.timerDuration) {
      timeGoalReached = true;
    }
    if (state.sessionType === 'finish-by' && state.targetTime) {
      const [hours, minutes] = state.targetTime.split(':').map(Number);
      const target = new Date(); target.setHours(hours, minutes, 0, 0);
      if (new Date() >= target) timeGoalReached = true;
    }

    // Count overtime seconds after goal reached
    if (timeGoalReached && state.sessionType === 'timer') {
      overtimeSeconds = sessionSeconds - state.timerDuration;
    }

    // WPM Idle Decay
    let currentWpm = state.wpm;
    if (state.wordSnapshots.length > 0) {
      const lastActive = state.wordSnapshots[state.wordSnapshots.length - 1].timestamp;
      if (Date.now() - lastActive > 10000) currentWpm = 0; // Drop to 0 after 10s idle
    }

    return { seconds: newSeconds, timeGoalReached, overtimeSeconds, wpm: currentWpm };
  }),
}));
