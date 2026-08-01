import { describe, it, expect } from 'vitest';
import { versionsToPrune } from '../maintenance/pruneVersions';

// A note keeps a full copy of its text per writing session and nothing ever
// removed them, on a database whose quota cannot be raised even with billing.
describe('versionsToPrune', () => {
  const versions = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it('keeps everything while the history is short', () => {
    expect(versionsToPrune(versions(21), 20)).toEqual([]);
  });

  it('never drops the first version — it is the note\'s origin', () => {
    const doomed = versionsToPrune(versions(50), 20);
    expect(doomed).not.toContain(1);
  });

  it('drops exactly the middle, keeping the first and the last N', () => {
    const doomed = versionsToPrune(versions(50), 20);
    expect(doomed[0]).toBe(2);
    expect(doomed.at(-1)).toBe(30);
    expect(doomed).toHaveLength(29);
  });

  it('is a no-op at the boundary', () => {
    expect(versionsToPrune(versions(3), 2)).toEqual([]);
    expect(versionsToPrune(versions(4), 2)).toEqual([2]);
  });
});
