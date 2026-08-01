import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { getDb } from '../shared/firestore';

/**
 * How many recent snapshots of a note stay in the cloud, on top of the first one.
 *
 * A note keeps a version per writing session, and a version carries the full
 * text — so a note written in daily for a year holds a year of full copies, and
 * nothing ever removed them. On a free-tier database whose quota cannot be
 * raised even with billing enabled, unbounded growth is the ceiling everything
 * else runs into.
 */
const KEEP_RECENT = Number(process.env.VERSIONS_KEEP_RECENT ?? 20);

/** Which versions to delete, given the ones that exist, oldest first.
 *  The first version is the note's origin and is never dropped. */
export function versionsToPrune<T>(ordered: T[], keepRecent = KEEP_RECENT): T[] {
  if (ordered.length <= keepRecent + 1) return [];
  return ordered.slice(1, ordered.length - keepRecent);
}

/**
 * Trims a note's version history when a new version arrives.
 *
 * Deliberately a write trigger, not a scheduled sweep: the work is proportional
 * to what the user actually writes, and a nightly scan over every note is the
 * exact pattern that exhausted this project's daily READ quota once already.
 * The count aggregation costs a fraction of a read, and the delete query only
 * runs on the notes that are over the limit.
 */
export const pruneOldVersions = onDocumentCreated(
  'users/{userId}/documents/{documentId}/versions/{versionId}',
  async (event) => {
    const { userId, documentId } = event.params;
    const db = getDb();
    const versions = db.collection(`users/${userId}/documents/${documentId}/versions`);

    try {
      const count = (await versions.count().get()).data().count;
      if (count <= KEEP_RECENT + 1) return;

      // Oldest first, and the very first one is skipped by versionsToPrune.
      const snap = await versions.orderBy('version', 'asc').limit(count - KEEP_RECENT).get();
      const doomed = versionsToPrune(snap.docs, KEEP_RECENT);
      if (doomed.length === 0) return;

      const batch = db.batch();
      for (const d of doomed) batch.delete(d.ref);
      await batch.commit();

      logger.info('[pruneOldVersions] trimmed version history', {
        documentId, removed: doomed.length, kept: KEEP_RECENT + 1,
      });
    } catch (e) {
      // Never fail the user's save because housekeeping could not run.
      logger.error('[pruneOldVersions] failed', e);
    }
  },
);
