import { describe, it, expect, beforeEach } from 'vitest';
import {
  isGlobalWriteFailure,
  blockCloudWritesToday,
  areCloudWritesBlockedToday,
} from '../writeBudget';

describe('global cloud-write failures', () => {
  beforeEach(() => localStorage.clear());

  // The exact shapes Firestore produced during the 2026-07-28 quota exhaustion
  // and the summary/embedding rule mismatch that preceded it.
  it('recognises a quota exhaustion by code and by message', () => {
    expect(isGlobalWriteFailure(Object.assign(new Error('x'), { code: 'resource-exhausted' }))).toBe(true);
    expect(isGlobalWriteFailure(Object.assign(new Error('x'), { code: 'firestore/resource-exhausted' }))).toBe(true);
    expect(isGlobalWriteFailure(new Error('Quota limit exceeded. Retry after quota limits are reset'))).toBe(true);
  });

  it('recognises a rule rejection', () => {
    expect(isGlobalWriteFailure(Object.assign(new Error('x'), { code: 'permission-denied' }))).toBe(true);
    expect(isGlobalWriteFailure(new Error('Missing or insufficient permissions.'))).toBe(true);
  });

  // Per-document problems must stay per-document: blocking the whole day on
  // one oversized or malformed record would be worse than the bug being fixed.
  it('does not treat a per-record failure as global', () => {
    expect(isGlobalWriteFailure(new Error('document exceeds the maximum allowed size'))).toBe(false);
    expect(isGlobalWriteFailure(Object.assign(new Error('x'), { code: 'unavailable' }))).toBe(false);
    expect(isGlobalWriteFailure(new Error('ENCRYPT_REQUIRED: session key not available'))).toBe(false);
    expect(isGlobalWriteFailure(null)).toBe(false);
  });

  it('blocks writes for today and reports it', () => {
    expect(areCloudWritesBlockedToday()).toBe(false);
    blockCloudWritesToday();
    expect(areCloudWritesBlockedToday()).toBe(true);
  });

  it('stops blocking once the stored day is no longer today', () => {
    localStorage.setItem('firestore_cloud_writes_blocked', '2020-01-01');
    expect(areCloudWritesBlockedToday()).toBe(false);
  });
});
