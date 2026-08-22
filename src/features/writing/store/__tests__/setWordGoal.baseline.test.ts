// TEST-1 §2.2 (store half): a caller that omits wordCount keeps the old
// baseline — the previous `?? 0` made every forgetful caller instantly
// re-reach the goal.
import { describe, it, expect, beforeEach } from 'vitest';
import { useTimerStore } from '../useTimerStore';

beforeEach(() => {
  useTimerStore.setState({
    status: 'writing',
    wordGoal: 100,
    wordGoalReached: true,
    sessionStartWords: 1000,
  } as Partial<ReturnType<typeof useTimerStore.getState>>);
});

describe('2.2 setWordGoal baseline fallback', () => {
  it('keeps the baseline when wordCount is omitted', () => {
    useTimerStore.getState().setWordGoal(250);
    const s = useTimerStore.getState();
    expect(s.wordGoal).toBe(250);
    expect(s.sessionStartWords).toBe(1000);
    expect(s.wordGoalReached).toBe(false);
  });

  it('uses the provided count when given', () => {
    useTimerStore.getState().setWordGoal(300, 4200);
    const s = useTimerStore.getState();
    expect(s.sessionStartWords).toBe(4200);
  });
});
