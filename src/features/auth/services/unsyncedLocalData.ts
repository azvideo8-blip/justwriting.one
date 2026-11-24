import { getLocalDb } from '../../../core/storage/localDb';

export interface UnsyncedLocalData {
  /** Notes that exist only on this device — nothing to restore them from. */
  localOnly: number;
  /** Edits waiting in the sync queue: written locally, not yet in the cloud. */
  pending: number;
  /** Linked notes whose cloud copy is behind and which no queue task will bring up (over the size limit). */
  behind: number;
  /** AI data not in the cloud: dialogues, memory, portrait (waiting, refused, too large).
   *  null — its journal is unreadable: «не знаю», не ноль. */
  ai: number | null;
  /** Unfinished drafts, which are never uploaded until the session is saved. */
  drafts: number;
  total: number;
}

/**
 * Thrown instead of wiping the device when data would not survive it.
 *
 * Signing out clears every local store, which is right on a shared machine and
 * safe when the cloud holds a copy — but the app tells the user "ничего не
 * теряется, всё восстановится из облака", and for a local-only note, a queued
 * edit or an unfinished draft that promise is simply false. The wipe has to
 * refuse rather than trust each caller to check first.
 */
export class UnsyncedLocalDataError extends Error {
  readonly data: UnsyncedLocalData;
  constructor(data: UnsyncedLocalData) {
    super(`Sign-out would destroy ${data.total} unsynced item(s)`);
    this.name = 'UnsyncedLocalDataError';
    this.data = data;
  }
}

// AUD-11: очистка локальных хранилищ не удалась (залоченная база, отказ
// транзакции, квота). Выход при этом продолжается — но человек должен узнать,
// что данные на этой машине остались. Диалог выхода ловит эту ошибку вместо
// тоста об успехе.
export class LocalWipeFailedError extends Error {
  constructor(cause: unknown) {
    super('LOCAL_WIPE_FAILED');
    this.name = 'LocalWipeFailedError';
    this.cause = cause;
  }
}

/**
 * What a wipe would destroy for good. Counts what CANNOT be brought back, not
 * everything stored: a note with a cloud copy is restored on the next sign-in.
 */
export async function countUnsyncedLocalData(userId: string | undefined): Promise<UnsyncedLocalData> {
  const empty: UnsyncedLocalData = { localOnly: 0, pending: 0, behind: 0, ai: 0, drafts: 0, total: 0 };
  if (!userId) return empty;

  const db = await getLocalDb(userId);

  const docs = await db.getAll('documents');
  // `localOnly` notes are deliberately kept off the cloud — which makes them the
  // ones a wipe destroys most completely, so they count too.
  const localOnly = docs.filter(d => d.guestId === userId && !d.linkedCloudId).length;

  const queue = await db.getAll('syncQueue');
  const tasks = queue.filter(i => !i.id.startsWith('lock_cloud_'));
  const pending = tasks.length;

  // Заметка переросла лимит: облачная копия осталась на прежней версии, а в очередь
  // её не ставят (StorageService, TOO_LARGE). Метка неизвестна — «отстаёт», только если
  // заметка велика для выгрузки: остальным метку поставит ближайшая сверка.
  const queued = new Set(tasks.map(i => i.documentId));
  const behind = docs.filter(d => d.guestId === userId && Boolean(d.linkedCloudId) && !queued.has(d.id)
    && (d.lastSyncedCloudVersion === undefined
      ? d.isTooLargeForSync === true
      : (d.currentVersion ?? 0) > d.lastSyncedCloudVersion)).length;

  // Диалоги, память и портрет едут своим журналом, не очередью заметок.
  const { getPendingUpsertKeySet } = await import('../../../core/services/LocalStoreSyncService');
  const ai = getPendingUpsertKeySet(userId)?.size ?? null;

  const drafts = await db.getAll('drafts');
  const draftCount = drafts.filter(d => d.userId === userId && (d.content ?? '').trim().length > 0).length;

  return {
    localOnly,
    pending,
    behind,
    ai,
    drafts: draftCount,
    total: localOnly + pending + behind + (ai ?? 0) + draftCount,
  };
}
