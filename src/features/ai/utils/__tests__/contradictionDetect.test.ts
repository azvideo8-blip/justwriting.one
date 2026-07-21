import { describe, it, expect } from 'vitest';
import { detectContradictions, formatContradictions } from '../contradictionDetect';
import type { AITimelineEntry } from '../../../../core/storage/localDb';

describe('contradictionDetect', () => {
  it('detects valence changes in themes', () => {
    // Dates are relative to "now" — the function's baseline/recent split is a
    // rolling 7-day window, so hardcoded dates would age out and go flaky.
    const fmt = (daysAgo: number) => {
      const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      return d.toISOString().slice(0, 10);
    };
    const timeline: AITimelineEntry[] = [
      // baseline (older than 7 days): positive
      { documentId: '1', date: fmt(9), month: fmt(9).slice(0, 7), facts: [], themes: ['работа'], valence: 0.6 },
      { documentId: '2', date: fmt(8), month: fmt(8).slice(0, 7), facts: [], themes: ['работа'], valence: 0.8 },
      // recent (within 7 days): negative
      { documentId: '3', date: fmt(1), month: fmt(1).slice(0, 7), facts: [], themes: ['работа'], valence: -0.5 },
      { documentId: '4', date: fmt(0), month: fmt(0).slice(0, 7), facts: [], themes: ['работа'], valence: -0.7 },
    ];

    const results = detectContradictions(timeline);
    expect(results).toHaveLength(1);
    expect(results[0]?.theme).toBe('работа');
    expect(results[0]?.oldValence).toBeGreaterThan(0.25);
    expect(results[0]?.newValence).toBeLessThan(-0.25);
  });

  it('formats contradictions nicely', () => {
    const contradictions = [
      { theme: 'работа', oldValence: 0.7, newValence: -0.6 }
    ];
    const block = formatContradictions(contradictions);
    expect(block).toBe('[Внутреннее противоречие]: Твое отношение к теме "работа" изменилось (раньше: позитивно, сейчас: негативно).');
  });
});
