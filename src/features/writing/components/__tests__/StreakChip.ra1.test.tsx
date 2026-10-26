import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreakChip } from '../StreakChip';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    tp: (k: string, n: number) => `${k}:${n}`,
    language: 'ru',
  }),
}));

describe('RA1-6: чип серии', () => {
  it('серия 0 — не прячется, зовёт начать новую', () => {
    render(<StreakChip days={0} />);
    expect(screen.getByTestId('streak-chip')).toHaveTextContent('home_streak_start');
  });

  it('серия 3 — число и склонение', () => {
    render(<StreakChip days={3} />);
    expect(screen.getByTestId('streak-chip')).toHaveTextContent('home_streak_days:3');
  });
});
