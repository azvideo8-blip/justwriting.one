// TEST-1 §2.12: a day is coloured by the SESSION's word delta, not by the
// whole note's size.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../../../shared/i18n', () => ({
  useLanguage: () => ({ t: (k: string) => k, tp: (k: string, n: number) => `${n} ${k}`, language: 'ru' }),
}));
vi.mock('../../../../shared/hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

import { Heatmap } from '../Heatmap';
import type { Session } from '../../../../shared/types/common';

const today = new Date();
today.setHours(12, 0, 0, 0);

const base = {
  userId: 'u1',
  content: 'x',
  duration: 1,
  charCount: 0,
  wpm: 0,
  createdAt: today,
  sessionStartTime: today.getTime(),
} as const;

describe('2.12 heatmap daily delta', () => {
  it('a one-word edit on a 10000-word note paints ~3, not 10000', () => {
    const { container } = render(
      <Heatmap sessions={[{ ...base, wordCount: 10000, sessionWordsAdded: 3 } as unknown as Session]} />,
    );
    const labels = Array.from(container.querySelectorAll('[aria-label]'))
      .map(el => el.getAttribute('aria-label') ?? '');
    expect(labels.some(l => l.includes('— 3 '))).toBe(true);
    expect(labels.every(l => !l.includes('10000'))).toBe(true);
  });

  // Дейлик 04.11 Н-3: день, поставленный заметке вручную, есть в числе серии.
  it('a day set on a note with sittings is painted, as the streak counts it', () => {
    const earlier = new Date(today); earlier.setDate(today.getDate() - 3);
    const session = {
      ...base, wordCount: 5, sessionStartTime: today.getTime(),
      sittings: [{ savedAt: earlier.getTime(), wordsAdded: 5 }],
    } as unknown as Session;
    const { container } = render(<Heatmap sessions={[session]} />);
    const painted = Array.from(container.querySelectorAll('rect[aria-label]'))
      .filter(r => r.getAttribute('fill') !== 'var(--surface-elevated)');
    expect(painted).toHaveLength(2); // день подхода и день, поставленный заметке
  });

  it('falls back to wordCount when the session has no delta (legacy docs)', () => {
    const { container } = render(
      <Heatmap sessions={[{ ...base, wordCount: 700 } as unknown as Session]} />,
    );
    const labels2 = Array.from(container.querySelectorAll('[aria-label]'))
      .map(el => el.getAttribute('aria-label') ?? '');
    expect(labels2.some(l => l.includes('— 700 '))).toBe(true);
  });
});
