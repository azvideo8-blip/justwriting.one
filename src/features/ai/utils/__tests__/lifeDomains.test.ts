import { describe, it, expect } from 'vitest';
import { LIFE_DOMAINS } from '../lifeDomains';

describe('LIFE_DOMAINS', () => {
  it('ids are all unique', () => {
    const ids = LIFE_DOMAINS.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every domain has a non-empty seed string', () => {
    for (const d of LIFE_DOMAINS) {
      expect(typeof d.seed).toBe('string');
      expect(d.seed.length).toBeGreaterThan(0);
    }
  });

  it('every threshold, when defined, is strictly between 0 and 1', () => {
    for (const d of LIFE_DOMAINS) {
      if (d.threshold === undefined) continue;
      expect(d.threshold).toBeGreaterThan(0);
      expect(d.threshold).toBeLessThan(1);
    }
  });
});
