import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useWritingStore } from '../store/useWritingStore';

const INITIAL_STATE = {
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  lastWordCount: 0, wpmHistory: [],
  seconds: 0, status: 'idle' as const, sessionType: 'free' as const,
  timerDuration: 30 * 60, targetTime: null, wordGoal: 1000,
  timeGoalReached: false, wordGoalReached: false, overtimeSeconds: 0,
  sessionStartWords: 0, sessionStartSeconds: 0, accumulatedDuration: 0,
  tags: [], labelId: undefined, initialDuration: 0,
  activeSessionId: null, savedDocumentId: null, sessionStartTime: null,
};

beforeEach(() => {
  useWritingStore.setState(INITIAL_STATE);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── tick() ──────────────────────────────────────────────────────────────────

describe('tick()', () => {
  it('status idle → seconds do not increase', () => {
    useWritingStore.setState({ status: 'idle', seconds: 0 });
    useWritingStore.getState().tick();
    expect(useWritingStore.getState().seconds).toBe(0);
  });

  it('status writing → seconds increase by 1', () => {
    useWritingStore.setState({ status: 'writing', seconds: 10 });
    useWritingStore.getState().tick();
    expect(useWritingStore.getState().seconds).toBe(11);
  });

  it('status paused → seconds do not increase', () => {
    useWritingStore.setState({ status: 'paused', seconds: 10 });
    useWritingStore.getState().tick();
    expect(useWritingStore.getState().seconds).toBe(10);
  });

  it('timer mode: after timerDuration ticks → timeGoalReached = true', () => {
    // Set up: sessionType=timer, timerDuration=5, sessionStartSeconds=0
    useWritingStore.setState({
      status: 'writing',
      sessionType: 'timer',
      timerDuration: 5,
      sessionStartSeconds: 0,
      seconds: 0,
      timeGoalReached: false,
    });
    // Tick 5 times: after 5th tick seconds = 5, sessionSeconds = 5 >= timerDuration
    for (let i = 0; i < 5; i++) {
      useWritingStore.getState().tick();
    }
    expect(useWritingStore.getState().timeGoalReached).toBe(true);
    expect(useWritingStore.getState().seconds).toBe(5);
  });

  it('overtimeSeconds counts up after timeGoalReached', () => {
    useWritingStore.setState({
      status: 'writing',
      sessionType: 'timer',
      timerDuration: 5,
      sessionStartSeconds: 0,
      seconds: 5,
      timeGoalReached: true,
      overtimeSeconds: 0,
    });
    // Tick once more → seconds = 6, overtime = 6 - 5 = 1
    useWritingStore.getState().tick();
    expect(useWritingStore.getState().overtimeSeconds).toBe(1);
  });

  it('WPM decays when last word snapshot is > 5s ago', () => {
    const now = Date.now();
    vi.setSystemTime(now + 10_000); // jump 10s into the future
    useWritingStore.setState({
      status: 'writing',
      seconds: 10,
      wpm: 100,
      wordSnapshots: [{ timestamp: now, wordCount: 50 }], // 10s old
    });
    useWritingStore.getState().tick();
    // wpm should decrease by ~5% per tick
    expect(useWritingStore.getState().wpm).toBeLessThan(100);
  });

  it('WPM does NOT decay when snapshot is recent (< 5s ago)', () => {
    const now = Date.now();
    vi.setSystemTime(now + 2_000); // only 2s into the future
    useWritingStore.setState({
      status: 'writing',
      seconds: 5,
      wpm: 80,
      wordSnapshots: [{ timestamp: now, wordCount: 50 }], // 2s old
    });
    useWritingStore.getState().tick();
    expect(useWritingStore.getState().wpm).toBe(80);
  });
});

// ─── setTimerDuration() ───────────────────────────────────────────────────────

describe('setTimerDuration()', () => {
  it('when timeGoalReached=true and status=writing: resets overtimeSeconds and updates accumulatedDuration', () => {
    useWritingStore.setState({
      status: 'writing',
      timeGoalReached: true,
      overtimeSeconds: 10,
      accumulatedDuration: 0,
      seconds: 60,
      sessionStartSeconds: 0,
    });
    useWritingStore.getState().setTimerDuration(10 * 60);
    const state = useWritingStore.getState();
    expect(state.overtimeSeconds).toBe(0);
    expect(state.timeGoalReached).toBe(false);
    expect(state.accumulatedDuration).toBe(60); // seconds - sessionStartSeconds
    expect(state.sessionStartSeconds).toBe(60);
  });

  it('when timeGoalReached=false: just updates timerDuration', () => {
    useWritingStore.setState({
      status: 'writing',
      timeGoalReached: false,
      overtimeSeconds: 0,
      timerDuration: 30 * 60,
    });
    useWritingStore.getState().setTimerDuration(20 * 60);
    const state = useWritingStore.getState();
    expect(state.timerDuration).toBe(20 * 60);
    expect(state.overtimeSeconds).toBe(0);
  });

  it('when status=idle (not active): just updates timerDuration', () => {
    useWritingStore.setState({ status: 'idle', timerDuration: 30 * 60 });
    useWritingStore.getState().setTimerDuration(15 * 60);
    expect(useWritingStore.getState().timerDuration).toBe(15 * 60);
  });
});

// ─── setWordGoal() ────────────────────────────────────────────────────────────

describe('setWordGoal()', () => {
  it('when wordGoalReached=true: resets wordGoalReached and updates sessionStartWords', () => {
    useWritingStore.setState({
      status: 'writing',
      wordGoalReached: true,
      wordCount: 250,
      wordGoal: 200,
    });
    useWritingStore.getState().setWordGoal(500);
    const state = useWritingStore.getState();
    expect(state.wordGoal).toBe(500);
    expect(state.wordGoalReached).toBe(false);
    expect(state.sessionStartWords).toBe(250);
  });

  it('when wordGoalReached=false: just updates wordGoal', () => {
    useWritingStore.setState({
      status: 'writing',
      wordGoalReached: false,
      sessionStartWords: 0,
    });
    useWritingStore.getState().setWordGoal(750);
    const state = useWritingStore.getState();
    expect(state.wordGoal).toBe(750);
    expect(state.sessionStartWords).toBe(0);
  });
});

// ─── finishSession() and resetSession() ──────────────────────────────────────

describe('finishSession()', () => {
  beforeEach(() => {
    useWritingStore.setState({
      content: 'some text',
      title: 'My story',
      wpm: 50,
      seconds: 120,
      status: 'writing',
      wpmHistory: [{ timestamp: 100, wpm: 50 }],
      wordSnapshots: [{ timestamp: 100, wordCount: 10 }],
    });
  });

  it('resets content to empty string', () => {
    useWritingStore.getState().finishSession();
    expect(useWritingStore.getState().content).toBe('');
  });

  it('resets wpm to 0', () => {
    useWritingStore.getState().finishSession();
    expect(useWritingStore.getState().wpm).toBe(0);
  });

  it('resets seconds to 0', () => {
    useWritingStore.getState().finishSession();
    expect(useWritingStore.getState().seconds).toBe(0);
  });

  it('resets status to idle', () => {
    useWritingStore.getState().finishSession();
    expect(useWritingStore.getState().status).toBe('idle');
  });

  it('clears wpmHistory', () => {
    useWritingStore.getState().finishSession();
    expect(useWritingStore.getState().wpmHistory).toHaveLength(0);
  });

  it('clears wordSnapshots', () => {
    useWritingStore.getState().finishSession();
    expect(useWritingStore.getState().wordSnapshots).toHaveLength(0);
  });
});

describe('resetSession()', () => {
  beforeEach(() => {
    useWritingStore.setState({
      content: 'some text',
      title: 'My story',
      wpm: 50,
      seconds: 120,
      status: 'writing',
      wpmHistory: [{ timestamp: 100, wpm: 50 }],
      wordSnapshots: [{ timestamp: 100, wordCount: 10 }],
    });
  });

  it('resets content to empty string', () => {
    useWritingStore.getState().resetSession();
    expect(useWritingStore.getState().content).toBe('');
  });

  it('resets wpm to 0', () => {
    useWritingStore.getState().resetSession();
    expect(useWritingStore.getState().wpm).toBe(0);
  });

  it('resets seconds to 0', () => {
    useWritingStore.getState().resetSession();
    expect(useWritingStore.getState().seconds).toBe(0);
  });

  it('resets status to idle', () => {
    useWritingStore.getState().resetSession();
    expect(useWritingStore.getState().status).toBe('idle');
  });

  it('clears wpmHistory', () => {
    useWritingStore.getState().resetSession();
    expect(useWritingStore.getState().wpmHistory).toHaveLength(0);
  });

  it('clears wordSnapshots', () => {
    useWritingStore.getState().resetSession();
    expect(useWritingStore.getState().wordSnapshots).toHaveLength(0);
  });
});

// ─── wpmHistory via pushWpmHistory ───────────────────────────────────────────

describe('wpmHistory', () => {
  it('pushWpmHistory accumulates entries', () => {
    useWritingStore.getState().pushWpmHistory({ timestamp: 1000, wpm: 60 });
    useWritingStore.getState().pushWpmHistory({ timestamp: 2000, wpm: 80 });
    expect(useWritingStore.getState().wpmHistory).toHaveLength(2);
    expect(useWritingStore.getState().wpmHistory[0].wpm).toBe(60);
    expect(useWritingStore.getState().wpmHistory[1].wpm).toBe(80);
  });

  it('finishSession clears wpmHistory', () => {
    useWritingStore.getState().pushWpmHistory({ timestamp: 1000, wpm: 60 });
    useWritingStore.getState().finishSession();
    expect(useWritingStore.getState().wpmHistory).toHaveLength(0);
  });

  it('resetSession clears wpmHistory', () => {
    useWritingStore.getState().pushWpmHistory({ timestamp: 1000, wpm: 60 });
    useWritingStore.getState().resetSession();
    expect(useWritingStore.getState().wpmHistory).toHaveLength(0);
  });
});
