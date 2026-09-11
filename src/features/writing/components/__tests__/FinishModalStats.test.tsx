import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FinishModalStats } from '../FinishModalStats';

// Mock WpmChart to avoid canvas rendering issues
vi.mock('../WpmChart', () => ({
  WpmChart: () => <div data-testid="wpm-chart" />,
}));

describe('S-20: FinishModalStats word counts and session metrics', () => {
  const t = (k: string, params?: Record<string, string | number>) => {
    if (k === 'writing_words') return 'СЛОВ';
    if (k === 'writing_time') return 'ВРЕМЯ';
    if (k === 'writing_wpm') return 'СЛОВ/МИН';
    if (k === 'finish_total_words') return `всего: ${params?.n}`;
    if (k === 'reading_time') return `~${params?.n} мин чтения`;
    if (k === 'finish_streak_zero') return 'Начни сегодня!';
    return k;
  };

  const baseProps = {
    animSeconds: 60,
    animWpm: 75,
    sessionSeconds: 60,
    totalPauseSeconds: 0,
    avgWpm: 75,
    wpmHistory: [],
    streakDays: 0,
    sessionGroups: [],
    readingMinutes: 1,
    t,
    isMobile: false,
    statsExpanded: true,
    setStatsExpanded: vi.fn(),
  };

  it('renders session words under words metric matching session WPM', () => {
    // 50 words written during this session, total in note is 2050
    render(
      <FinishModalStats
        {...baseProps}
        animWords={50}
        totalWords={2050}
      />
    );

    // Primary animated number is the session words (50)
    expect(screen.getByText('50')).toBeInTheDocument();
    // Total note words displayed as subtitle
    expect(screen.getByText('всего: 2050')).toBeInTheDocument();
    // WPM and time on same card
    expect(screen.getByText('1:00')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
  });

  it('does not render total words subtitle when note was written from scratch (total == session)', () => {
    // New document: 50 words written, total is 50
    render(
      <FinishModalStats
        {...baseProps}
        animWords={50}
        totalWords={50}
      />
    );

    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.queryByText(/всего:/)).not.toBeInTheDocument();
  });

  it('renders total words in mobile view when total > session words', () => {
    render(
      <FinishModalStats
        {...baseProps}
        isMobile={true}
        animWords={30}
        totalWords={500}
      />
    );

    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('всего: 500')).toBeInTheDocument();
  });
});
