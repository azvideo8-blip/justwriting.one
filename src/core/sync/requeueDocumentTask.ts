import { getLocalDb } from '../storage/localDb';

/**
 * R3-6: поставить заметку в очередь выгрузки, НЕ сбрасывая счётчик попыток.
 *
 * Раньше каждое место писало задачу заново — без attempts/dead/lastError, и
 * bumpAttempts всегда видел 1: MAX_ATTEMPTS не наступал, задача, которая не
 * выполнится никогда (нечитаемая облачная версия), крутилась вечно, а
 * withDocumentLock ещё и снимал карантин. Теперь существующая задача
 * сохраняет свою историю; новая создаётся как раньше.
 */
export async function requeueDocumentTask(documentId: string, ownerId?: string | null): Promise<void> {
  const db = await getLocalDb();
  const tx = db.transaction('syncQueue', 'readwrite');
  const id = `sync_${documentId}`;
  const existing = await tx.store.get(id);
  await tx.store.put({
    ...(existing ?? {}),
    id,
    documentId,
    type: 'document' as const,
    createdAt: existing?.createdAt ?? Date.now(),
    ...(ownerId ? { ownerId } : existing?.ownerId ? { ownerId: existing.ownerId } : {}),
  });
  await tx.done;
}
