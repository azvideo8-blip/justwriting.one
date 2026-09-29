import { getLocalDb } from '../storage/localDb';
import { matchRule } from './classifySyncError';

/**
 * A-2.1 / R3-6: перепостановка заметки в очередь выгрузки на новую правку.
 *
 * Сохраняет createdAt (жизненный цикл исходной постановки) и всю историю
 * задачи (attempts/dead/lastError) — ничего из этого не сбрасывается;
 * поднимается только updatedAt. Почему так — комментарий в теле функции.
 */
export async function requeueDocumentTask(documentId: string, ownerId?: string | null): Promise<void> {
  const db = await getLocalDb(ownerId ?? undefined);
  const tx = db.transaction('syncQueue', 'readwrite');
  const id = `sync_${documentId}`;
  const existing = await tx.store.get(id);
  // История задачи (attempts/dead/lastError) сохраняется: это путь ПОВТОРА
  // (замок занят, офлайн, нечитаемая облачная версия), а не новой правки —
  // сброс счётчика здесь и был петлёй R3-6. Новая правка идёт через
  // addToSyncQueue, и там мёртвая задача заменяется свежей. Меняется только
  // updatedAt: без него снимок дренажа (SB-1) снял бы задачу как «не менялась».
  await tx.store.put({
    ...(existing ?? {}),
    id,
    documentId,
    type: 'document' as const,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
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
