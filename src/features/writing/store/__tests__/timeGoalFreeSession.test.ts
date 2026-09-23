// D-10: на десктопе сессия всегда 'free', а проверка цели по времени жила
// только в ветке sessionType === 'timer'. Итог: «Цель по времени 25 мин» из
// нижней панели отсчитывалась и писала «истекло», но тост/звук не звучали.
// Теперь явная цель (setTimerDuration) срабатывает и в free-сессии;
// AG-TIMER-1 цел: finish-by цель по времени не учитывает, а дефолтные
// 30 минут без явного выбора не срабатывают вовсе.
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimerStore } from '../useTimerStore';

function s() { return useTimerStore.getState(); }

describe('time goal in a free session (D-10)', () => {
  beforeEach(() => {
    useTimerStore.setState({
      status: 'idle', sessionType: 'free',
      seconds: 0, _accumulatedMs: 0, _startWallMs: null,
      sessionStartSeconds: 0, sessionStartEpochMs: null,
      timerDuration: 30 * 60, timeGoalExplicit: false,
      timeGoalReached: false, wordGoalReached: false, overtimeSeconds: 0,
    });
  });

  // Помогает завести сессию с нужным sessionStartSeconds без реального времени.
  function startWithSessionStart(sessionStartSeconds: number) {
    useTimerStore.setState({
      status: 'writing', sessionType: 'free',
      _startWallMs: performance.now(), _accumulatedMs: 0,
      sessionStartSeconds,
    });
  }

  it('fires once an explicitly chosen duration is elapsed in a free session', () => {
    s().setTimerDuration(25 * 60);
    expect(s().timeGoalExplicit).toBe(true);
    startWithSessionStart(0);
    // 24 мин — рано.
    useTimerStore.setState({ _accumulatedMs: 24 * 60 * 1000, _startWallMs: null });
    s().checkGoals();
    expect(s().timeGoalReached).toBe(false);
    // 25 мин — цель достигнута.
    useTimerStore.setState({ _accumulatedMs: 25 * 60 * 1000 });
    s().checkGoals();
    expect(s().timeGoalReached).toBe(true);
  });

  it('does not fire the default 30-minute duration that nobody chose', () => {
    startWithSessionStart(0);
    useTimerStore.setState({ _accumulatedMs: 31 * 60 * 1000, _startWallMs: null });
    s().checkGoals();
    expect(s().timeGoalReached).toBe(false);
  });

  it('clearing the goal (duration 0) cannot fire', () => {
    s().setTimerDuration(0);
    expect(s().timeGoalExplicit).toBe(false);
    startWithSessionStart(0);
    useTimerStore.setState({ _accumulatedMs: 31 * 60 * 1000, _startWallMs: null });
    s().checkGoals();
    expect(s().timeGoalReached).toBe(false);
  });

  it('AG-TIMER-1: a finish-by session still ignores the time-duration goal', () => {
    s().setTimerDuration(1 * 60);
    useTimerStore.setState({
      status: 'writing', sessionType: 'finish-by', targetTime: null,
      _startWallMs: null, _accumulatedMs: 6 * 60 * 1000, sessionStartSeconds: 0,
    });
    s().checkGoals();
    expect(s().timeGoalReached).toBe(false);
  });

  it('timer sessions keep working as before', () => {
    s().setTimerDuration(5 * 60);
    useTimerStore.setState({
      status: 'writing', sessionType: 'timer',
      _startWallMs: null, _accumulatedMs: 5 * 60 * 1000, sessionStartSeconds: 0,
    });
    s().checkGoals();
    expect(s().timeGoalReached).toBe(true);
  });
});
