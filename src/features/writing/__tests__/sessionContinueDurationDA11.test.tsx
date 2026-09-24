import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { useTimerStore } from '../store/useTimerStore';
import { useContentStore } from '../store/useContentStore';
import { loadDraftIntoStore } from '../store/storeActions';
import { FinishModalStats } from '../components/FinishModalStats';

vi.mock('../components/WpmChart', () => ({
  WpmChart: () => <div data-testid="wpm-chart" />,
}));

describe('DA-11: Window completion: time and wpm when continuing old note', () => {
  beforeEach(() => {
    useTimerStore.setState({
      status: 'idle',
      seconds: 0,
      sessionStartSeconds: 0,
      accumulatedDuration: 0,
      initialDuration: 0,
      totalPauseSeconds: 0,
    });
    useContentStore.setState({
      content: '',
      title: '',
      initialWordCount: 0,
      wordCount: 0,
    });
  });

  it('sets initialDuration equal to past note duration when loading note into store', () => {
    loadDraftIntoStore({
      content: 'Past 1000 words...',
      title: 'Old Note',
      wordCount: 1000,
      savedDocumentId: 'doc_1',
      accumulatedDuration: 7200,
      initialDuration: 7200,
    });

    const timerState = useTimerStore.getState();
    expect(timerState.accumulatedDuration).toBe(7200);
    expect(timerState.initialDuration).toBe(7200);
  });

  it('calculates sessionSeconds and avgWpm from initial baseline instead of total history', () => {
    // Note had 7200s history, user writes 60 words in 180s (3 minutes)
    useTimerStore.setState({
      accumulatedDuration: 7200,
      initialDuration: 7200,
      seconds: 180,
      sessionStartSeconds: 0,
      totalPauseSeconds: 0,
    });
    useContentStore.setState({
      initialWordCount: 1000,
      wordCount: 1060,
    });

    const timer = useTimerStore.getState();
    const content = useContentStore.getState();

    const totalAccumulatedSeconds = timer.accumulatedDuration + Math.max(0, timer.seconds - timer.sessionStartSeconds);
    const sessionSeconds = Math.max(0, totalAccumulatedSeconds - timer.initialDuration);
    const sessionWords = Math.max(0, content.wordCount - content.initialWordCount);
    const avgWpm = sessionSeconds > 0
      ? Math.round((sessionWords / sessionSeconds) * 60)
      : 0;

    expect(totalAccumulatedSeconds).toBe(7380);
    expect(sessionSeconds).toBe(180);
    expect(sessionWords).toBe(60);
    expect(avgWpm).toBe(20); // 60 words in 3 mins = 20 wpm, not 0!
  });

  it('FinishModalStats renders total note duration when continuing note with past history', () => {
    const t = (k: string, params?: Record<string, string | number>) => {
      if (k === 'writing_words') return 'СЛОВ';
      if (k === 'writing_time') return 'ВРЕМЯ';
      if (k === 'writing_wpm') return 'СЛОВ/МИН';
      if (k === 'finish_total_words') return `всего: ${params?.n}`;
      if (k === 'finish_total_time') return `всего: ${params?.t}`;
      if (k === 'reading_time') return `~${params?.n} мин чтения`;
      if (k === 'finish_streak_zero') return 'Начни сегодня!';
      return k;
    };

    render(
      <FinishModalStats
        animWords={60}
        animSeconds={180}
        animWpm={20}
        sessionSeconds={180}
        totalPauseSeconds={0}
        avgWpm={20}
        wpmHistory={[]}
        streakDays={0}
        sessionGroups={[]}
        readingMinutes={4}
        t={t}
        isMobile={false}
        statsExpanded={true}
        setStatsExpanded={vi.fn()}
        totalWords={1060}
        totalDuration={7380}
      />
    );

    // Active session time: 3:00
    expect(screen.getByText('3:00')).toBeInTheDocument();
    // Total note time: 2:03:00
    expect(screen.getByText('всего: 2:03:00')).toBeInTheDocument();
  });
});
