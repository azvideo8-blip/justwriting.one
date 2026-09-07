import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { deleteLocalDatabase } from '../localDb';

describe('E-8: deleteLocalDatabase', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects with DATABASE_DELETION_BLOCKED when onblocked does not resolve within 500ms', async () => {
    const fakeReq: any = {};
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((() => {
      setTimeout(() => {
        if (fakeReq.onblocked) fakeReq.onblocked(new Event('blocked'));
      }, 10);
      return fakeReq;
    }) as any);

    const promise = deleteLocalDatabase('user_test_blocked');

    // Advance 10ms for onblocked to trigger
    await vi.advanceTimersByTimeAsync(15);
    // Advance remaining to exceed 500ms
    const advance = vi.advanceTimersByTimeAsync(550);

    await expect(promise).rejects.toThrow('DATABASE_DELETION_BLOCKED');
    await advance;
  });

  it('resolves if onsuccess fires after onblocked within 500ms', async () => {
    const fakeReq: any = {};
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((() => {
      setTimeout(() => {
        if (fakeReq.onblocked) fakeReq.onblocked(new Event('blocked'));
      }, 10);
      setTimeout(() => {
        if (fakeReq.onsuccess) fakeReq.onsuccess(new Event('success'));
      }, 100);
      return fakeReq;
    }) as any);

    const promise = deleteLocalDatabase('user_test_resolved');
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).resolves.toBeUndefined();
  });
});
