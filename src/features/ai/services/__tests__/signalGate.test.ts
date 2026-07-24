import { describe, it, expect } from 'vitest';
import {
  hasEnoughSignal,
  calculateUniqueMonths,
  SIGNAL_THRESHOLDS,
} from '../signalGate';

describe('B3 signalGate', () => {
  describe('calculateUniqueMonths', () => {
    it('returns 0 for empty or invalid dates', () => {
      expect(calculateUniqueMonths([])).toBe(0);
      expect(calculateUniqueMonths([null, undefined, 'invalid-date'])).toBe(0);
    });

    it('deduplicates dates in the same calendar month', () => {
      const dates = [
        '2026-07-01T10:00:00Z',
        '2026-07-15T12:00:00Z',
        '2026-07-31T23:59:59Z',
      ];
      expect(calculateUniqueMonths(dates)).toBe(1);
    });

    it('counts distinct YYYY-MM calendar months', () => {
      const dates = [
        '2026-05-10T10:00:00Z',
        '2026-06-15T12:00:00Z',
        '2026-07-01T08:00:00Z',
      ];
      expect(calculateUniqueMonths(dates)).toBe(3);
    });
  });

  describe('hasEnoughSignal', () => {
    it('evaluates episode vs trait boundary (same month vs multi-month)', () => {
      const threshold = { minCount: 5, minUniqueMonths: 2 };

      // Episode: 5 notes in July 2026
      const episodeDates = [
        '2026-07-01T10:00:00Z',
        '2026-07-02T10:00:00Z',
        '2026-07-03T10:00:00Z',
        '2026-07-04T10:00:00Z',
        '2026-07-05T10:00:00Z',
      ];
      expect(hasEnoughSignal({ count: 5, dates: episodeDates }, threshold)).toBe(false);

      // Trait: 5 notes across June and July 2026
      const traitDates = [
        '2026-06-25T10:00:00Z',
        '2026-06-28T10:00:00Z',
        '2026-07-01T10:00:00Z',
        '2026-07-02T10:00:00Z',
        '2026-07-03T10:00:00Z',
      ];
      expect(hasEnoughSignal({ count: 5, dates: traitDates }, threshold)).toBe(true);
    });

    it('works directly with pre-calculated SignalStats', () => {
      const threshold = SIGNAL_THRESHOLDS.lexicon; // { minCount: 5, minUniqueMonths: 2 }

      expect(hasEnoughSignal({ count: 4, uniqueMonths: 2 }, threshold)).toBe(false);
      expect(hasEnoughSignal({ count: 5, uniqueMonths: 1 }, threshold)).toBe(false);
      expect(hasEnoughSignal({ count: 5, uniqueMonths: 2 }, threshold)).toBe(true);
      expect(hasEnoughSignal({ count: 10, uniqueMonths: 3 }, threshold)).toBe(true);
    });
  });
});
