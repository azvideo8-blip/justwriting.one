import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useContentStore } from '../store/useContentStore';
import { useTimerStore } from '../store/useTimerStore';
import { useSessionMetaStore } from '../store/useSessionMetaStore';
import { resetAndClear, finishSession, resetSession } from '../store/storeActions';
import { applyWpmDecay } from '../hooks/useWpm';

const CONTENT_INITIAL = {
  content: '', title: '', pinnedThoughts: [],
  wordCount: 0, initialWordCount: 0, wpm: 0, wordSnapshots: [],
  lastWordCount: 0, wpmHistory: [],
  tags: [], labelId: undefined,
};

const TIMER_INITIAL = {
  seconds: 0, status: 'idle' as const, sessionType: 'free' as const,
  timerDuration: 30 * 60, targetTime: null, wordGoal: 1000,
  timeGoalReached: false, wordGoalReached: false, overtimeSeconds: 0,
  sessionStartWords: 0, sessionStartSeconds: 0, accumulatedDuration: 0,
  totalPauseSeconds: 0, _pauseWallStart: null as number | null,
  initialDuration: 0,
};

const META_INITIAL = {
  activeSessionId: null, savedDocumentId: null, sessionStartTime: null as number | null,
};

beforeEach(() => {
  useContentStore.setState(CONTENT_INITIAL);
  useTimerStore.setState(TIMER_INITIAL);
  useSessionMetaStore.setState(META_INITIAL);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── tick() ──────────────────────────────────────────────────────────────────

describe('tick()', () => {
  it('status idle → seconds do not increase', () => {
    useTimerStore.setState({ status: 'idle', seconds: 0 });
    useTimerStore.getState().tick();
    expect(useTimerStore.getState().seconds).toBe(0);
  });

  it('status writing → seconds increase by 1', () => {
    useTimerStore.setState({ status: 'writing', seconds: 10 });
    useTimerStore.getState().tick();
    expect(useTimerStore.getState().seconds).toBe(11);
  });

  it('status paused → seconds do not increase', () => {
    useTimerStore.setState({ status: 'paused', seconds: 10 });
    useTimerStore.getState().tick();
    expect(useTimerStore.getState().seconds).toBe(10);
  });

  it('timer mode: after timerDuration ticks → timeGoalReached = true', () => {
    useTimerStore.setState({
      status: 'writing',
      sessionType: 'timer',
      timerDuration: 5,
      sessionStartSeconds: 0,
      seconds: 0,
      timeGoalReached: false,
    });
    for (let i = 0; i < 5; i++) {
      useTimerStore.getState().tick();
    }
    expect(useTimerStore.getState().timeGoalReached).toBe(true);
    expect(useTimerStore.getState().seconds).toBe(5);
  });

  it('overtimeSeconds counts up after timeGoalReached', () => {
    useTimerStore.setState({
      status: 'writing',
      sessionType: 'timer',
      timerDuration: 5,
      sessionStartSeconds: 0,
      seconds: 5,
      timeGoalReached: true,
      overtimeSeconds: 0,
    });
    useTimerStore.getState().tick();
    expect(useTimerStore.getState().overtimeSeconds).toBe(1);
  });
});

// ─── WPM decay ───────────────────────────────────────────────────────────────

describe('WPM decay', () => {
  it('WPM decays when last word snapshot is > 5s ago', () => {
    const now = Date.now();
    vi.setSystemTime(now + 10_000);
    useContentStore.setState({
      wpm: 100,
      wordSnapshots: [{ timestamp: now, wordCount: 50 }],
    });
    useTimerStore.setState({ status: 'writing', seconds: 10 });
    applyWpmDecay();
    expect(useContentStore.getState().wpm).toBeLessThan(100);
  });

  it('WPM does NOT decay when snapshot is recent (< 5s ago)', () => {
    const now = Date.now();
    vi.setSystemTime(now + 2_000);
    useContentStore.setState({
      wpm: 80,
      wordSnapshots: [{ timestamp: now, wordCount: 50 }],
    });
    useTimerStore.setState({ status: 'writing', seconds: 5 });
    applyWpmDecay();
    expect(useContentStore.getState().wpm).toBe(80);
  });
});

// ─── setTimerDuration() ───────────────────────────────────────────────────────

describe('setTimerDuration()', () => {
  it('when timeGoalReached=true and status=writing: resets overtimeSeconds and updates accumulatedDuration', () => {
    useTimerStore.setState({
      status: 'writing',
      timeGoalReached: true,
      overtimeSeconds: 10,
      accumulatedDuration: 0,
      seconds: 60,
      sessionStartSeconds: 0,
    });
    useTimerStore.getState().setTimerDuration(10 * 60);
    const state = useTimerStore.getState();
    expect(state.overtimeSeconds).toBe(0);
    expect(state.timeGoalReached).toBe(false);
    expect(state.accumulatedDuration).toBe(60);
    expect(state.sessionStartSeconds).toBe(60);
  });

  it('when timeGoalReached=false: just updates timerDuration', () => {
    useTimerStore.setState({
      status: 'writing',
      timeGoalReached: false,
      overtimeSeconds: 0,
      timerDuration: 30 * 60,
    });
    useTimerStore.getState().setTimerDuration(20 * 60);
    const state = useTimerStore.getState();
    expect(state.timerDuration).toBe(20 * 60);
    expect(state.overtimeSeconds).toBe(0);
  });

  it('when status=idle (not active): just updates timerDuration', () => {
    useTimerStore.setState({ status: 'idle', timerDuration: 30 * 60 });
    useTimerStore.getState().setTimerDuration(15 * 60);
    expect(useTimerStore.getState().timerDuration).toBe(15 * 60);
  });
});

// ─── setWordGoal() ────────────────────────────────────────────────────────────

describe('setWordGoal()', () => {
  it('when wordGoalReached=true: resets wordGoalReached and updates sessionStartWords', () => {
    useContentStore.setState({ wordCount: 250 });
    useTimerStore.setState({
      status: 'writing',
      wordGoalReached: true,
      wordGoal: 200,
    });
    useTimerStore.getState().setWordGoal(500);
    const state = useTimerStore.getState();
    expect(state.wordGoal).toBe(500);
    expect(state.wordGoalReached).toBe(false);
    expect(state.sessionStartWords).toBe(250);
  });

  it('when wordGoalReached=false: just updates wordGoal', () => {
    useTimerStore.setState({
      status: 'writing',
      wordGoalReached: false,
      sessionStartWords: 0,
    });
    useTimerStore.getState().setWordGoal(750);
    const state = useTimerStore.getState();
    expect(state.wordGoal).toBe(750);
    expect(state.sessionStartWords).toBe(0);
  });
});

// ─── finishSession() and resetSession() ──────────────────────────────────────

describe('finishSession()', () => {
  beforeEach(() => {
    useContentStore.setState({
      content: 'some text',
      title: 'My story',
      wpm: 50,
      wpmHistory: [{ timestamp: 100, wpm: 50 }],
      wordSnapshots: [{ timestamp: 100, wordCount: 10 }],
    });
    useTimerStore.setState({
      seconds: 120,
      status: 'writing',
    });
  });

  it('resets content to empty string', () => {
    finishSession();
    expect(useContentStore.getState().content).toBe('');
  });

  it('resets wpm to 0', () => {
    finishSession();
    expect(useContentStore.getState().wpm).toBe(0);
  });

  it('resets seconds to 0', () => {
    finishSession();
    expect(useTimerStore.getState().seconds).toBe(0);
  });

  it('resets status to idle', () => {
    finishSession();
    expect(useTimerStore.getState().status).toBe('idle');
  });

  it('clears wpmHistory', () => {
    finishSession();
    expect(useContentStore.getState().wpmHistory).toHaveLength(0);
  });

  it('clears wordSnapshots', () => {
    finishSession();
    expect(useContentStore.getState().wordSnapshots).toHaveLength(0);
  });
});

describe('resetSession()', () => {
  beforeEach(() => {
    useContentStore.setState({
      content: 'some text',
      title: 'My story',
      wpm: 50,
      wpmHistory: [{ timestamp: 100, wpm: 50 }],
      wordSnapshots: [{ timestamp: 100, wordCount: 10 }],
    });
    useTimerStore.setState({
      seconds: 120,
      status: 'writing',
    });
  });

  it('resets content to empty string', () => {
    resetSession();
    expect(useContentStore.getState().content).toBe('');
  });

  it('resets wpm to 0', () => {
    resetSession();
    expect(useContentStore.getState().wpm).toBe(0);
  });

  it('resets seconds to 0', () => {
    resetSession();
    expect(useTimerStore.getState().seconds).toBe(0);
  });

  it('resets status to idle', () => {
    resetSession();
    expect(useTimerStore.getState().status).toBe('idle');
  });

  it('clears wpmHistory', () => {
    resetSession();
    expect(useContentStore.getState().wpmHistory).toHaveLength(0);
  });

  it('clears wordSnapshots', () => {
    resetSession();
    expect(useContentStore.getState().wordSnapshots).toHaveLength(0);
  });
});

// ─── wpmHistory via pushWpmHistory ───────────────────────────────────────────

describe('wpmHistory', () => {
  it('pushWpmHistory accumulates entries', () => {
    useContentStore.getState().pushWpmHistory({ timestamp: 1000, wpm: 60 });
    useContentStore.getState().pushWpmHistory({ timestamp: 2000, wpm: 80 });
    expect(useContentStore.getState().wpmHistory).toHaveLength(2);
    expect(useContentStore.getState().wpmHistory[0].wpm).toBe(60);
    expect(useContentStore.getState().wpmHistory[1].wpm).toBe(80);
  });

  it('finishSession clears wpmHistory', () => {
    useContentStore.getState().pushWpmHistory({ timestamp: 1000, wpm: 60 });
    finishSession();
    expect(useContentStore.getState().wpmHistory).toHaveLength(0);
  });

  it('resetSession clears wpmHistory', () => {
    useContentStore.getState().pushWpmHistory({ timestamp: 1000, wpm: 60 });
    resetSession();
    expect(useContentStore.getState().wpmHistory).toHaveLength(0);
  });
});
