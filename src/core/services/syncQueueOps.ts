import { getLocalDb } from '../storage/localDb';

export function announceQueueChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('sync-queue-changed'));
  } catch { /* non-critical */ }
}

export async function addToSyncQueue(documentId: string, ownerId?: string): Promise<void> {
  const db = await getLocalDb(ownerId);
  // The queue task inherits the note's owner. A task with no owner could be
  // drained under whichever account happens to be signed in next.
  const doc = await db.get('documents', documentId);
  const tx = db.transaction('syncQueue', 'readwrite');
  const taskId = `sync_${documentId}`;
  const existing = await tx.store.get(taskId);
  const cutoff = Date.now() - 60_000;
  // Overwrite or update task; avoid rapid re-queueing of recent tasks unless failed/dead
  if (!existing || existing.createdAt < cutoff || existing.dead) {
    await tx.store.put({
      id: taskId,
      documentId,
      type: 'document' as const,
      createdAt: Date.now(),
      ownerId: doc?.guestId,
    });
  }
  await tx.done;
  announceQueueChange();
}
