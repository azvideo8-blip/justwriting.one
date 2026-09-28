import { getLocalDb } from '../storage/localDb';
import { matchRule } from './classifySyncError';

/**
 * A-2.1 / R3-6: перепостановка заметки в очередь выгрузки на новую правку.
 *
 * Сохраняет createdAt (жизненный цикл исходной постановки), но обновляет updatedAt
 * (чтобы задача пережила снимок дренажа _clearQueueItemsIfUnchanged), сбрасывает
 * dead: false, attempts: 0 и очищает lastError, давая новой правке свежий бюджет
 * попыток.
 */
export async function requeueDocumentTask(documentId: string, ownerId?: string | null): Promise<void> {
  const db = await getLocalDb(ownerId ?? undefined);
  const tx = db.transaction('syncQueue', 'readwrite');
  const id = `sync_${documentId}`;
  const existing = await tx.store.get(id);
  const { lastError: _dropLastError, ...rest } = existing ?? {};
  await tx.store.put({
    ...rest,
    id,
    documentId,
    type: 'document' as const,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    dead: false,
    attempts: 0,
    ...(ownerId ? { ownerId } : existing?.ownerId ? { ownerId: existing.ownerId } : {}),
  });
  await tx.done;
}

/**
 * A-2.2 (F-053): ставит задачу в очередь в статусе карантина (dead: true)
 * с кодом ошибки из classifySyncError, чтобы ошибка отражалась в счетчиках
 * и задача могла быть оживлена при разблокировке сейфа (reviveLockedTasks).
 */
export async function quarantineDocumentTask(
  documentId: string,
  ownerId: string | null | undefined,
  error: unknown,
): Promise<void> {
  const db = await getLocalDb(ownerId ?? undefined);
  const tx = db.transaction('syncQueue', 'readwrite');
  const id = `sync_${documentId}`;
  const existing = await tx.store.get(id);
  const rule = matchRule(error);
  const lastError = rule?.code ?? (error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR'));
  await tx.store.put({
    ...(existing ?? {}),
    id,
    documentId,
    type: 'document' as const,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    dead: true,
    lastError,
    attempts: existing?.attempts ?? 1,
    ...(ownerId ? { ownerId } : existing?.ownerId ? { ownerId: existing.ownerId } : {}),
  });
  await tx.done;
}
