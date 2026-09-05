import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useTimerStore } from '../store/useTimerStore';
import { MeStatsSection } from '../components/MeStatsSection';

vi.mock('../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => {
      if (k === 'unit_hour') return 'ч';
      if (k === 'me_stat_total_time') return 'в потоке';
      return k;
    },
  }),
}));

describe('AG-TIMER-1: finish-by deadline gating', () => {
  beforeEach(() => {
    useTimerStore.setState({
      seconds: 0,
      sessionStartSeconds: 0,
      status: 'idle',
      sessionType: 'free',
      targetTime: null,
      timeGoalReached: false,
      _startWallMs: null,
      _accumulatedMs: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('set deadline, start a free session, cross the deadline: no goal event fires', () => {
    const now = new Date();
    // Set targetTime to 1 minute in the past
    const pastMinutes = now.getMinutes() > 0 ? now.getMinutes() - 1 : 59;
    const pastHours = now.getMinutes() > 0 ? now.getHours() : (now.getHours() > 0 ? now.getHours() - 1 : 23);
    const target = `${String(pastHours).padStart(2, '0')}:${String(pastMinutes).padStart(2, '0')}`;

    useTimerStore.setState({
      sessionType: 'free',
      targetTime: target,
      status: 'writing',
      _startWallMs: Date.now() - 5000,
      _accumulatedMs: 0,
    });

    useTimerStore.getState().checkGoals();

    expect(useTimerStore.getState().timeGoalReached).toBe(false);
  });

  it('a real finish-by session still fires at its deadline', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    const targetDate = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes ago
    const target = `${String(targetDate.getHours()).padStart(2, '0')}:${String(targetDate.getMinutes()).padStart(2, '0')}`;

    useTimerStore.setState({
      sessionType: 'finish-by',
      targetTime: target,
      status: 'writing',
      sessionStartEpochMs: start.getTime(),
      _startWallMs: start.getTime(),
      _accumulatedMs: 0,
    });

    useTimerStore.getState().checkGoals();

    expect(useTimerStore.getState().timeGoalReached).toBe(true);
  });
});

describe('AG-STAT-2: MeStatsSection total writing time calculation', () => {
  it('3600 seconds renders as 1ч, not 60ч', () => {
    const profile = {
      totalWordCount: 500,
      sessionsCount: 2,
      streakDays: 3,
      totalDuration: 3600, // 3600 seconds = 1 hour
      avgWpm: 40,
      avgSessionWords: 250,
    };

    render(<MeStatsSection profile={profile as any} />);

    expect(screen.getByText('1ч')).toBeDefined();
    expect(screen.queryByText('60ч')).toBeNull();
  });
});
