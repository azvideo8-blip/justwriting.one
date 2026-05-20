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
  seconds: 0, sessionStartSeconds: 0, status: 'idle' as const, sessionType: 'free' as const,
  timerDuration: 30 * 60, targetTime: null, wordGoal: 1000,
  timeGoalReached: false, wordGoalReached: false, overtimeSeconds: 0,
  sessionStartWords: 0,
  _startWallMs: null as number | null, _accumulatedMs: 0,
  sessionStartWallMs: null as number | null, sessionStartAccMs: 0,
  accumulatedDuration: 0,
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── performance.now timer ────────────────────────────────────────────────

describe('performance.now-based timer', () => {
  it('status idle → getElapsedSeconds returns 0', () => {
    useTimerStore.setState({ status: 'idle', _accumulatedMs: 0, _startWallMs: null });
    expect(useTimerStore.getState().getElapsedSeconds()).toBe(0);
  });

  it('status writing → getElapsedSeconds computes from performance.now', () => {
    const startMs = 10000;
    useTimerStore.setState({ status: 'writing', _startWallMs: startMs, _accumulatedMs: 0 });
    vi.spyOn(performance, 'now').mockReturnValue(startMs + 5000);
    expect(useTimerStore.getState().getElapsedSeconds()).toBe(5);
    vi.restoreAllMocks();
  });

  it('status paused → getElapsedSeconds returns accumulatedMs', () => {
    useTimerStore.setState({ status: 'paused', _accumulatedMs: 10000, _startWallMs: null });
    expect(useTimerStore.getState().getElapsedSeconds()).toBe(10);
  });

  it('timer mode: checkGoals sets timeGoalReached when sessionSeconds >= timerDuration', () => {
    const startMs = 10000;
    useTimerStore.setState({
      status: 'writing',
      sessionType: 'timer',
      timerDuration: 5,
      sessionStartSeconds: 0,
      _startWallMs: startMs,
      _accumulatedMs: 0,
      timeGoalReached: false,
    });
    vi.spyOn(performance, 'now').mockReturnValue(startMs + 5000);
    useTimerStore.getState().checkGoals();
    expect(useTimerStore.getState().timeGoalReached).toBe(true);
    expect(useTimerStore.getState().seconds).toBe(5);
    vi.restoreAllMocks();
  });

  it('overtimeSeconds counts up after timeGoalReached', () => {
    const startMs = 10000;
    useTimerStore.setState({
      status: 'writing',
      sessionType: 'timer',
      timerDuration: 5,
      sessionStartSeconds: 0,
      _startWallMs: startMs,
      _accumulatedMs: 0,
      timeGoalReached: true,
      overtimeSeconds: 0,
    });
    vi.spyOn(performance, 'now').mockReturnValue(startMs + 6000);
    useTimerStore.getState().checkGoals();
    expect(useTimerStore.getState().overtimeSeconds).toBe(1);
    vi.restoreAllMocks();
  });

  it('pauseSession accumulates elapsed ms', () => {
    const startMs = 10000;
    useTimerStore.setState({ status: 'writing', _startWallMs: startMs, _accumulatedMs: 0 });
    vi.spyOn(performance, 'now').mockReturnValue(startMs + 3000);
    useTimerStore.getState().pauseSession();
    expect(useTimerStore.getState()._accumulatedMs).toBe(3000);
    expect(useTimerStore.getState()._startWallMs).toBeNull();
    expect(useTimerStore.getState().seconds).toBe(3);
    vi.restoreAllMocks();
  });

  it('resumeSession sets new _startWallMs', () => {
    useTimerStore.setState({ status: 'paused', _accumulatedMs: 5000, _startWallMs: null, _pauseWallStart: Date.now() - 2000 });
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now);
    useTimerStore.getState().resumeSession();
    expect(useTimerStore.getState()._startWallMs).toBe(now);
    expect(useTimerStore.getState().status).toBe('writing');
    vi.restoreAllMocks();
  });
});

// ─── WPM decay ───────────────────────────────────────────────────────────────

describe('WPM decay', () => {
  it('WPM decays when last word snapshot is > 5s ago', () => {
    const now = Date.now();
    useContentStore.setState({
      wpm: 100,
      wordSnapshots: [{ timestamp: now, wordCount: 50 }],
    });
    vi.useFakeTimers();
    vi.setSystemTime(now + 10_000);
    useTimerStore.setState({ status: 'writing', _startWallMs: 0, _accumulatedMs: 10000 });
    applyWpmDecay();
    expect(useContentStore.getState().wpm).toBeLessThan(100);
    vi.useRealTimers();
  });

  it('WPM does NOT decay when snapshot is recent (< 5s ago)', () => {
    const now = Date.now();
    useContentStore.setState({
      wpm: 80,
      wordSnapshots: [{ timestamp: now, wordCount: 50 }],
    });
    vi.useFakeTimers();
    vi.setSystemTime(now + 2_000);
    useTimerStore.setState({ status: 'writing' });
    applyWpmDecay();
    expect(useContentStore.getState().wpm).toBe(80);
    vi.useRealTimers();
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
      _startWallMs: 0,
      _accumulatedMs: 0,
    });
    vi.spyOn(performance, 'now').mockReturnValue(60000);
    useTimerStore.getState().setTimerDuration(10 * 60);
    const state = useTimerStore.getState();
    expect(state.overtimeSeconds).toBe(0);
    expect(state.timeGoalReached).toBe(false);
    expect(state.accumulatedDuration).toBe(60);
    expect(state.sessionStartSeconds).toBe(60);
    vi.restoreAllMocks();
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
      _startWallMs: 0,
      _accumulatedMs: 0,
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
      _startWallMs: 0,
      _accumulatedMs: 0,
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
