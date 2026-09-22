import { describe, it, expect } from 'vitest';
import { isExcludedFromAI } from '../isExcludedFromAI';

describe('isExcludedFromAI', () => {
  it('returns false for null / undefined', () => {
    expect(isExcludedFromAI(null)).toBe(false);
    expect(isExcludedFromAI(undefined)).toBe(false);
  });

  it('returns false when neither excludedFromAI nor trashedAt is set', () => {
    expect(isExcludedFromAI({})).toBe(false);
    expect(isExcludedFromAI({ excludedFromAI: false, trashedAt: null })).toBe(false);
  });

  it('returns true when excludedFromAI is true', () => {
    expect(isExcludedFromAI({ excludedFromAI: true })).toBe(true);
  });

  it('returns true when trashedAt is set', () => {
    expect(isExcludedFromAI({ trashedAt: Date.now() })).toBe(true);
    expect(isExcludedFromAI({ trashedAt: 123456789 })).toBe(true);
  });

  it('returns true when both are set', () => {
    expect(isExcludedFromAI({ excludedFromAI: true, trashedAt: Date.now() })).toBe(true);
  });
});
