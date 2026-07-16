import { describe, it, expect } from 'vitest';
import { computeTrends, formatTrendsBlock } from '../contextTrends';
import type { AITimelineEntry } from '../../../../core/storage/localDb';

describe('contextTrends', () => {
  it('correctly identifies emerging and fading themes', () => {
    const timeline: AITimelineEntry[] = [
      { documentId: '1', date: '2026-07-01', month: '2026-07', facts: [], themes: ['работа', 'усталость'], valence: 0 },
      { documentId: '2', date: '2026-07-02', month: '2026-07', facts: [], themes: ['работа', 'хобби'], valence: 0.1 },
      { documentId: '3', date: '2026-07-08', month: '2026-07', facts: [], themes: ['спорт', 'отдых'], valence: 0.5 },
      { documentId: '4', date: '2026-07-09', month: '2026-07', facts: [], themes: ['спорт', 'семья'], valence: 0.6 },
    ];

    // Fixed reference so the 7-day recent/baseline window is deterministic:
    // now - 7d = 2026-07-08, so docs 3-4 are "recent", docs 1-2 "baseline".
    const trends = computeTrends(timeline, new Date('2026-07-15T12:00:00Z'));

    expect(trends.emergingThemes).toContain('спорт');
    expect(trends.emergingThemes).toContain('отдых');
    expect(trends.emergingThemes).toContain('семья');
    expect(trends.emergingThemes).not.toContain('работа');

    expect(trends.fadingThemes).toContain('работа');
    expect(trends.fadingThemes).toContain('усталость');
    expect(trends.fadingThemes).toContain('хобби');
    expect(trends.fadingThemes).not.toContain('спорт');

    expect(trends.moodSlope).toBe('improving');
    expect(trends.valenceDelta).toBeGreaterThan(0.15);
  });

  it('correctly calculates mood slope', () => {
    const timeline: AITimelineEntry[] = [
      { documentId: '1', date: '2026-07-01', month: '2026-07', facts: [], themes: [], valence: 0.5 },
      { documentId: '2', date: '2026-07-02', month: '2026-07', facts: [], themes: [], valence: 0.6 },
      { documentId: '3', date: '2026-07-08', month: '2026-07', facts: [], themes: [], valence: 0.1 },
      { documentId: '4', date: '2026-07-09', month: '2026-07', facts: [], themes: [], valence: 0.2 },
    ];

    const trends = computeTrends(timeline, new Date('2026-07-15T12:00:00Z'));
    expect(trends.moodSlope).toBe('declining');
  });

  it('formats clean trend block', () => {
    const trends = {
      emergingThemes: ['спорт', 'семья'],
      fadingThemes: ['работа'],
      moodSlope: 'improving' as const,
      valenceDelta: 0.4,
    };
    const block = formatTrendsBlock(trends);
    expect(block).toContain('[Изменения за последнее время]');
    expect(block).toContain('- Новые темы: спорт, семья');
    expect(block).toContain('- Ушедшие темы: работа');
    expect(block).toContain('- Динамика настроения: улучшается 📈');
  });
});
