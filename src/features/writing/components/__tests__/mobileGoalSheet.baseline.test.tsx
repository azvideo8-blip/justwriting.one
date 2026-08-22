// TEST-1 §2.2: setting a word goal from the mobile sheet keeps the session
// word baseline instead of resetting it to zero.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));

import { MobileGoalSheet } from '../MobileGoalSheet';
import { useTimerStore } from '../../store/useTimerStore';
import { useContentStore } from '../../store/useContentStore';

beforeEach(() => {
  useContentStore.setState({ content: 'уже написанный текст', wordCount: 5000 });
  useTimerStore.setState({
    status: 'writing',
    wordGoal: 100,
    wordGoalReached: true,
    sessionStartWords: 1000,
  } as Partial<ReturnType<typeof useTimerStore.getState>>);
});

describe('2.2 mobile word goal keeps the baseline', () => {
  it('preset 250 passes the current wordCount; baseline survives', () => {
    render(<MobileGoalSheet isOpen onClose={vi.fn()} />);
    const preset = screen.getAllByRole('button').find(b => b.textContent?.includes('250'));
    expect(preset).toBeDefined();
    fireEvent.click(preset!);

    const s = useTimerStore.getState();
    expect(s.wordGoal).toBe(250);
    // The sheet passes the CURRENT count (5000) — that is the fix: the old
    // sheet passed nothing and the store reset the baseline to 0.
    expect(s.sessionStartWords).toBe(5000);
    expect(s.wordGoalReached).toBe(false);
  });
});
