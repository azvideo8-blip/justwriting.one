import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../storage/localDb';
import { withDocumentLock, LOCK_TTL_MS } from '../withDocumentLock';

describe('DUP-3: withDocumentLock', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = await getLocalDb();
    await db.clear('syncQueue');
  });

  it('two concurrent writers on one document: one runs, one yields and queues, lock row is gone at the end', async () => {
    const docId = 'doc_concurrent_1';
    let firstStarted = false;
    let finishFirst: () => void;
    const firstGate = new Promise<void>(r => { finishFirst = r; });

    const p1 = withDocumentLock(
      docId,
      async () => {
        firstStarted = true;
        await firstGate;
        return 'winner';
      },
      {
        ownerId: 'user_1',
        onLockHeld: () => 'yielded',
      },
    );

    // Wait until p1 acquires lock
    await vi.waitFor(() => expect(firstStarted).toBe(true));

    // Second caller tries while first is holding lock
    const p2 = withDocumentLock(
      docId,
      async () => 'loser',
      {
        ownerId: 'user_2',
        onLockHeld: () => 'yielded',
      },
    );

    const res2 = await p2;
    expect(res2).toBe('yielded');

    // p2 must have queued a task for later drain
    const db = await getLocalDb();
    const queuedTask = await db.get('syncQueue', `sync_${docId}`);
    expect(queuedTask).toBeDefined();
    expect(queuedTask?.ownerId).toBe('user_2');

    // Finish first caller
    finishFirst!();
    const res1 = await p1;
    expect(res1).toBe('winner');

    // Lock row must be cleanly deleted at the end
    const lockRow = await db.get('syncQueue', `lock_cloud_${docId}`);
    expect(lockRow).toBeUndefined();
  });

  it('when runner throws, lock is still released', async () => {
    const docId = 'doc_throw_1';
    const db = await getLocalDb();

    await expect(
      withDocumentLock(docId, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const lockRow = await db.get('syncQueue', `lock_cloud_${docId}`);
    expect(lockRow).toBeUndefined();
  });

  it('a stalled holder past TTL losing lock does not delete new owner row', async () => {
    const docId = 'doc_stale_1';
    const db = await getLocalDb();

    let releaseFirst: () => void;
    const firstDone = new Promise<void>(r => { releaseFirst = r; });

    const p1 = withDocumentLock(
      docId,
      async () => {
        await firstDone;
      },
      { ttlMs: 50, heartbeat: false },
    );

    // Wait a little bit for p1 to acquire lock
    await vi.waitFor(async () => {
      const lock = await db.get('syncQueue', `lock_cloud_${docId}`);
      expect(lock).toBeDefined();
    });

    // Artificially age the lock row past TTL
    const lockTx = db.transaction('syncQueue', 'readwrite');
    const cur = await lockTx.store.get(`lock_cloud_${docId}`);
    expect(cur).toBeDefined();
    if (cur) {
      await lockTx.store.put({ ...cur, createdAt: Date.now() - 100_000 });
    }
    await lockTx.done;

    // Now a new caller takes the lock because it is expired
    let releaseSecond: () => void;
    const secondDone = new Promise<void>(r => { releaseSecond = r; });
    let secondAcquired = false;

    const p2 = withDocumentLock(
      docId,
      async (secondToken) => {
        secondAcquired = true;
        await secondDone;
        return secondToken;
      },
      { ttlMs: LOCK_TTL_MS },
    );

    await vi.waitFor(() => expect(secondAcquired).toBe(true));

    // First caller finishes its stalled work and exits (calls its finally block)
    releaseFirst!();
    await p1;

    // The lock row must still exist and belong to the second owner!
    const lockAfterP1Exit = await db.get('syncQueue', `lock_cloud_${docId}`);
    expect(lockAfterP1Exit).toBeDefined();

    // Now let second caller finish
    releaseSecond!();
    const secondToken = await p2;
    expect(lockAfterP1Exit?.ownerToken).toBe(secondToken);

    // And after second caller exits, lock is deleted
    const lockAfterP2Exit = await db.get('syncQueue', `lock_cloud_${docId}`);
    expect(lockAfterP2Exit).toBeUndefined();
  });
});
