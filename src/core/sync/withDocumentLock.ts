import { getLocalDb, randomUUID } from '../storage/localDb';
import { reportError } from '../../shared/errors/reportError';

export const LOCK_TTL_MS = 30_000;

export interface WithDocumentLockOptions<T> {
  onLockHeld?: (existingLock: unknown) => Promise<T> | T;
  ownerId?: string | undefined;
  ttlMs?: number | undefined;
  queueOnHeld?: boolean | undefined;
  heartbeat?: boolean | undefined;
}

/**
 * DUP-3: Unified document lock across sync entry points.
 * Ensures mutual exclusion, background heartbeat renewal, safe token-checked release,
 * and queuing for yields.
 */
export async function withDocumentLock<T>(
  documentId: string,
  fn: (lockOwnerToken: string) => Promise<T>,
  options?: WithDocumentLockOptions<T>,
): Promise<T> {
  const ttlMs = options?.ttlMs ?? LOCK_TTL_MS;
  const lockKey = `lock_cloud_${documentId}`;
  const lockOwnerToken = randomUUID();

  const db = await getLocalDb();
  const lockTx = db.transaction('syncQueue', 'readwrite');
  const existing = await lockTx.store.get(lockKey);

  if (existing) {
    const age = Date.now() - (existing.createdAt ?? 0);
    if (age < ttlMs) {
      await lockTx.done;
      if (options?.queueOnHeld !== false) {
        try {
          const queueDb = await getLocalDb();
          await queueDb.put('syncQueue', {
            id: `sync_${documentId}`,
            documentId,
            type: 'document' as const,
            createdAt: Date.now(),
            ...(options?.ownerId ? { ownerId: options.ownerId } : {}),
          });
        } catch (queueErr) {
          reportError(queueErr, { action: 'withDocumentLock_queueTask', documentId });
        }
      }
      if (options?.onLockHeld) {
        return await options.onLockHeld(existing);
      }
      // LOCK_HELD is deliberately not a substring of LOCKED; callers match on the prefix
      throw new Error(`LOCK_HELD: Document ${documentId} is currently locked`);
    }
  }

  await lockTx.store.put({
    id: lockKey,
    documentId,
    type: 'document' as const,
    createdAt: Date.now(),
    ownerToken: lockOwnerToken,
  });
  await lockTx.done;

  const lockHeartbeat = options?.heartbeat !== false
    ? setInterval(() => {
        void (async () => {
          try {
            const hdb = await getLocalDb();
            const htx = hdb.transaction('syncQueue', 'readwrite');
            const cur = await htx.store.get(lockKey);
            if (cur && cur.ownerToken === lockOwnerToken) {
              await htx.store.put({ ...cur, createdAt: Date.now() });
            }
            await htx.done;
          } catch {
            /* non-critical: stale lock is better than double write */
          }
        })();
      }, Math.max(1, Math.floor(ttlMs / 3)))
    : undefined;

  try {
    return await fn(lockOwnerToken);
  } finally {
    if (lockHeartbeat !== undefined) {
      clearInterval(lockHeartbeat);
    }
    try {
      const cleanupDb = await getLocalDb();
      const cleanupTx = cleanupDb.transaction('syncQueue', 'readwrite');
      const cur = await cleanupTx.store.get(lockKey);
      if (cur && cur.ownerToken === lockOwnerToken) {
        await cleanupTx.store.delete(lockKey);
      }
      await cleanupTx.done;
    } catch (cleanupErr) {
      reportError(cleanupErr, { action: 'withDocumentLock_lockCleanup', lockKey });
    }
  }
}
