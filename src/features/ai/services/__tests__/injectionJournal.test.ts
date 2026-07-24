import { describe, it, expect, beforeEach } from 'vitest';
import { InjectionJournal, calculateOverlapRatio } from '../injectionJournal';

describe('InjectionJournal & Overlap Metrics', () => {
  beforeEach(() => {
    InjectionJournal.clearJournal();
  });

  it('calculates word overlap ratio correctly', () => {
    expect(calculateOverlapRatio('hello world test', 'hello world test')).toBe(1.0);
    expect(calculateOverlapRatio('hello world', 'different text')).toBe(0.0);
    expect(calculateOverlapRatio('alpha beta gamma', 'alpha beta delta')).toBe(2 / 4); // 0.5
    expect(calculateOverlapRatio(null, null)).toBe(1.0);
  });

  it('logs entries into the journal buffer and retrieves latest entry', () => {
    const entry = InjectionJournal.logEntry({
      dialogueId: 'dlg-123',
      candidates: [
        { id: 'c1', category: 'voice', band: 'competitive', textSnippet: 'voice text', charLength: 10, selected: true },
      ],
      mandatoryInjected: [],
      competitiveInjected: ['voice text'],
    });

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeGreaterThan(0);

    const latest = InjectionJournal.getLatestEntry();
    expect(latest?.dialogueId).toBe('dlg-123');
    expect(latest?.competitiveInjected).toEqual(['voice text']);
  });

  it('caps journal buffer size to 100 entries', () => {
    for (let i = 0; i < 110; i++) {
      InjectionJournal.logEntry({
        dialogueId: `dlg-${i}`,
        candidates: [],
        mandatoryInjected: [],
        competitiveInjected: [],
      });
    }

    const entries = InjectionJournal.getEntries(200);
    expect(entries.length).toBe(100);
    expect(entries[0]!.dialogueId).toBe('dlg-109');

  });
});
