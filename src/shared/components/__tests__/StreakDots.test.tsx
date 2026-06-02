import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { screen } from '@testing-library/react';
import { StreakDots } from '../StreakDots';
import { renderWithProviders } from '../../../test/utils/render';

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: { children: React.ReactNode }) =>
      React.createElement('div', props, children),
  },
  useReducedMotion: () => false,
}));

describe('StreakDots', () => {
  it('renders mobile variant', () => {
    renderWithProviders(
      <StreakDots sessionGroups={[]} variant="mobile" />
    );
    expect(screen.getByRole('group', { name: 'Writing streak calendar' })).toBeInTheDocument();
  });

  it('renders modal variant', () => {
    renderWithProviders(
      <StreakDots sessionGroups={[]} variant="modal" />
    );
    expect(screen.getByRole('group', { name: 'Writing streak calendar' })).toBeInTheDocument();
  });

  it('renders 7 days', () => {
    renderWithProviders(
      <StreakDots sessionGroups={[]} variant="mobile" />
    );
    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBe(7);
  });

  it('marks days with sessions', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sessionGroups = [{ date: today, sessions: [{}] }];

    renderWithProviders(
      <StreakDots sessionGroups={sessionGroups} variant="mobile" />
    );

    const cells = screen.getAllByRole('gridcell');
    const todayCell = cells[cells.length - 1];
    expect(todayCell).toHaveAttribute('aria-label', expect.stringContaining('session written'));
  });

  it('marks days without sessions', () => {
    renderWithProviders(
      <StreakDots sessionGroups={[]} variant="mobile" />
    );

    const cells = screen.getAllByRole('gridcell');
    const yesterdayCell = cells[cells.length - 2];
    expect(yesterdayCell).toHaveAttribute('aria-label', expect.stringContaining('no session'));
  });

  it('shows day numbers', () => {
    renderWithProviders(
      <StreakDots sessionGroups={[]} variant="mobile" />
    );
    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBe(7);
    cells.forEach((cell) => {
      expect(cell.textContent).toMatch(/^\d{1,2}$/);
    });
  });
});
