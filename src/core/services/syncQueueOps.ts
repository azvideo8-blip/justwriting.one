import { getLocalDb } from '../storage/localDb';

export function announceQueueChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('sync-queue-changed'));
  } catch { /* non-critical */ }
}

/**
 * PR-1: облачные заметки, чьё удаление принято на устройстве и ждёт облака. Один
 * ответ для всех, кто показывает или скачивает облачные строки: такая строка в
 * облаке ещё жива, но для человека заметки уже нет. Прячет только задача, которую
 * дренаж исполнит: с отметкой revocable и не в карантине. Иначе заметку стало бы не увидеть.
 */
export async function pendingRemovalIds(userId: string): Promise<Set<string>> {
  const queue = await (await getLocalDb(userId)).getAll('syncQueue');
  return new Set(queue
    .filter(t => t.revocable && !t.dead && (t.ownerId === undefined || t.ownerId === userId))
    .map(t => t.documentId));
}

const PENDING_REMOVAL = 'PENDING_REMOVAL';

export async function assertNotPendingRemoval(userId: string, cloudId: string): Promise<void> {
  if ((await pendingRemovalIds(userId)).has(cloudId)) {
    throw new Error(`${PENDING_REMOVAL}: cloud document ${cloudId} is waiting to be removed`);
  }
}

export function isPendingRemoval(e: unknown): boolean {
  return String((e as { message?: unknown } | null)?.message ?? e).startsWith(PENDING_REMOVAL);
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
      ownerId: doc?.guestId ?? ownerId,
    });
  } else {
    // SB-1: молодую задачу не переставляем (это и есть смысл окна в 60 с — не
    // дублировать выгрузку на каждое сохранение), но обязано остаётся след
    // повторной постановки: правка, сохранённая во время полёта выгрузки,
    // иначе не отличима от «ничего нового», и дренаж снимает её по снимку.
    await tx.store.put({ ...existing, updatedAt: Date.now() });
  }
  await tx.done;
  announceQueueChange();
}
