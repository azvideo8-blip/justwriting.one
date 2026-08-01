import { getLocalDb } from '../../../core/storage/localDb';

export interface UnsyncedLocalData {
  /** Notes that exist only on this device — nothing to restore them from. */
  localOnly: number;
  /** Edits waiting in the sync queue: written locally, not yet in the cloud. */
  pending: number;
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

/**
 * What a wipe would destroy for good. Counts what CANNOT be brought back, not
 * everything stored: a note with a cloud copy is restored on the next sign-in.
 */
export async function countUnsyncedLocalData(userId: string | undefined): Promise<UnsyncedLocalData> {
  const empty: UnsyncedLocalData = { localOnly: 0, pending: 0, drafts: 0, total: 0 };
  if (!userId) return empty;

  const db = await getLocalDb();

  const docs = await db.getAll('documents');
  // `localOnly` notes are deliberately kept off the cloud — which makes them the
  // ones a wipe destroys most completely, so they count too.
  const localOnly = docs.filter(d => d.guestId === userId && !d.linkedCloudId).length;

  const queue = await db.getAll('syncQueue');
  const pending = queue.filter(i => !i.id.startsWith('lock_cloud_')).length;

  const drafts = await db.getAll('drafts');
  const draftCount = drafts.filter(d => d.userId === userId && (d.content ?? '').trim().length > 0).length;

  return {
    localOnly,
    pending,
    drafts: draftCount,
    total: localOnly + pending + draftCount,
  };
}
