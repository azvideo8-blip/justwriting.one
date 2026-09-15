import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/utils/render';
import { Calendar } from '../Calendar';
import { format } from 'date-fns';
import type { ArchiveSession } from '../../types';

describe('Calendar Heatmap (UI-11)', () => {
  const dummySession = (dateStr: string, wordCount: number): ArchiveSession => ({
    id: `s-${dateStr}`,
    userId: 'u1',
    content: 'hello',
    wordCount,
    charCount: wordCount * 5,
    duration: 60,
    wpm: 20,
    createdAt: new Date(`${dateStr}T12:00:00Z`),
    sessionStartTime: new Date(`${dateStr}T12:00:00Z`).getTime(),
  });

  it('renders heatmap shading and title with notes and words without dots', () => {
    const today = new Date();
    const curMonthPrefix = format(today, 'yyyy-MM');
    const day1 = `${curMonthPrefix}-01`;
    const day2 = `${curMonthPrefix}-02`;
    const day3 = `${curMonthPrefix}-03`;
    const day4 = `${curMonthPrefix}-04`;

    const sessions = [
      dummySession(day1, 100),
      dummySession(day2, 250),
      dummySession(day3, 600),
      dummySession(day4, 1500),
    ];

    const sessionsByDate = {
      [day1]: 1,
      [day2]: 2,
      [day3]: 3,
      [day4]: 5,
    };

    const wordsByDate = {
      [day1]: 100,
      [day2]: 250,
      [day3]: 600,
      [day4]: 1500,
    };

    const onSelectDate = vi.fn();

    renderWithProviders(
      <Calendar
        sessions={sessions}
        sessionsByDate={sessionsByDate}
        wordsByDate={wordsByDate}
        selectedDate={null}
        onSelectDate={onSelectDate}
      />
    );

    // Day 1 should have title and heatmap class
    const btnDay1 = screen.getByRole('button', { name: /^1$/ });
    expect(btnDay1.getAttribute('title')).toMatch(/1.*100/);
    expect(btnDay1.className).toContain('bg-text-main/10');

    // Day 4 (highest words) should have level 4 background and inverted text
    const btnDay4 = screen.getByRole('button', { name: /^4$/ });
    expect(btnDay4.getAttribute('title')).toMatch(/5.*1.*500/);
    expect(btnDay4.className).toContain('bg-text-main/55');
    expect(btnDay4.className).toContain('text-surface-base');

    // No pulse dots should exist in any calendar buttons
    expect(btnDay1.querySelector('.rounded-full.opacity-70')).toBeNull();
    expect(btnDay4.querySelector('.rounded-full.opacity-70')).toBeNull();
  });

  it('renders clean buttons with no heatmap background in empty month', () => {
    renderWithProviders(
      <Calendar
        sessions={[]}
        sessionsByDate={{}}
        wordsByDate={{}}
        selectedDate={null}
        onSelectDate={vi.fn()}
      />
    );

    const btnDay10 = screen.getByRole('button', { name: /^10$/ });
    expect(btnDay10.getAttribute('title')).toBeNull();
    expect(btnDay10.className).not.toContain('bg-text-main/10');
    expect(btnDay10.className).not.toContain('bg-text-main/55');
  });
});
