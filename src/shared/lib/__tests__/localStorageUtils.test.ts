import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('getLocalStorageUsageKB', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('returns 0 for empty localStorage', async () => {
    const { getLocalStorageUsageKB } = await import('../localStorageUtils');
    expect(getLocalStorageUsageKB()).toBe(0);
  });

  it('returns correct size for single item', async () => {
    const { getLocalStorageUsageKB } = await import('../localStorageUtils');
    const key = 'a';
    const value = 'b';
    localStorage.setItem(key, value);
    const expectedKB = ((key.length + value.length) * 2) / 1024;
    expect(getLocalStorageUsageKB()).toBeCloseTo(expectedKB, 6);
  });

  it('returns correct size for multiple items', async () => {
    const { getLocalStorageUsageKB } = await import('../localStorageUtils');
    localStorage.setItem('key1', 'value1');
    localStorage.setItem('key2', 'longer_value_here');
    const total =
      (('key1'.length + 'value1'.length) * 2 +
        ('key2'.length + 'longer_value_here'.length) * 2) /
      1024;
    expect(getLocalStorageUsageKB()).toBeCloseTo(total, 6);
  });

  it('caches result for 60 seconds', async () => {
    const { getLocalStorageUsageKB } = await import('../localStorageUtils');
    localStorage.setItem('key', 'value');
    const first = getLocalStorageUsageKB();
    localStorage.setItem('another', 'data');
    const second = getLocalStorageUsageKB();
    expect(second).toBe(first);
  });
});
