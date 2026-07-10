import { describe, it, expect } from 'vitest';
import { detectContradictions, formatContradictions } from '../contradictionDetect';
import type { AITimelineEntry } from '../../../../core/storage/localDb';

describe('contradictionDetect', () => {
  it('detects valence changes in themes', () => {
    const timeline: AITimelineEntry[] = [
      { documentId: '1', date: '2026-07-01', month: '2026-07', facts: [], themes: ['работа'], valence: 0.6 },
      { documentId: '2', date: '2026-07-02', month: '2026-07', facts: [], themes: ['работа'], valence: 0.8 },
      { documentId: '3', date: '2026-07-08', month: '2026-07', facts: [], themes: ['работа'], valence: -0.5 },
      { documentId: '4', date: '2026-07-09', month: '2026-07', facts: [], themes: ['работа'], valence: -0.7 },
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
