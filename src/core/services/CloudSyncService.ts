import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalStorageService } from './LocalStorageService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb, type LocalDocument } from '../storage/localDb';
import { Document } from '../../types';
import { toDate } from '../utils/dateUtils';
import { maybeEncrypt, maybeDecrypt, DecryptionError, type VersionEncryptPayload, getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { getSessionKey } from '../crypto/encrypt';
import { reportError } from '../../shared/errors/reportError';
import { withTimeout as withTimeoutBase } from '../../shared/utils/withTimeout';
import { isFirestoreConnected } from '../firebase/firestore';
import { getClient } from '../firebase/firestoreClient';
import { tryReserveBulkWriteBudget, areCloudWritesBlockedToday, isGlobalWriteFailure, blockCloudWritesToday } from '../firebase/writeBudget';
import pLimit from 'p-limit';
import { SaveDocumentData } from './storageTypes';
import { ConflictResolver } from './ConflictResolver';
import { useActivityLogStore } from '../../shared/activity/useActivityLogStore';

const CLOUD_SYNC_TIMEOUT = 30_000;
const LOCK_TTL_MS = 30_000;
// Must match AIProfileService's PORTRAIT_LS_KEY. Duplicated here (rather than
// imported) because core must not import from features/ (ARCHITECTURE.md) —
// AIProfileService.syncPortraitToCloud delegates to this method instead.
const PORTRAIT_LS_KEY = 'ai_user_portrait';

function withTimeout<T>(promise: Promise<T>, ms: number = CLOUD_SYNC_TIMEOUT): Promise<T> {
  return withTimeoutBase(promise, ms, 'Sync timeout');
}

/**
 * The highest version number the cloud can honestly claim after a partial
 * upload: the last one in an unbroken run from the oldest. Taking the maximum
 * instead would let a gap hide — versions 1 and 3 uploaded, 2 skipped, and the
 * document reports v3 while v2 does not exist.
 */
export function highestContiguousVersion(allVersions: number[], uploaded: Set<number>): number {
  let highest = 0;
  for (const v of [...allVersions].sort((a, b) => a - b)) {
    if (!uploaded.has(v)) break;
    highest = v;
  }
  return highest;
}

export const CloudSyncService = {
  async restoreMissingDocuments(userId: string): Promise<{ restored: number; hasMore: boolean }> {
    if (areCloudWritesBlockedToday()) {
      return { restored: 0, hasMore: true };
    }

    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { restored: 0, hasMore: false };
    }

    const lastListingTs = parseInt(localStorage.getItem('last_restore_listing_ts') || '0', 10);
    if (Date.now() - lastListingTs < 30 * 60 * 1000) {
      return { restored: 0, hasMore: false };
    }
    
    // We update the timestamp only if we are actually going to list.
    // However, if write budget blocks us after, we might want to try again sooner?
    // The requirement says "refuse to re-list more often than every 30 minutes".
    localStorage.setItem('last_restore_listing_ts', Date.now().toString());

    const cloudDocs = await DocumentService.getUserDocuments(userId);
    if (!cloudDocs.length) return { restored: 0, hasMore: false };

    cloudDocs.sort((a, b) => {
      const aTime = a.lastSessionAt?.getTime() ?? 0;
      const bTime = b.lastSessionAt?.getTime() ?? 0;
      return bTime - aTime;
    });

    const localDocs = await LocalStorageService.getGuestDocuments(userId);
    await relinkOrphaned(localDocs, cloudDocs);
    const localCloudIds = new Set(localDocs.map(d => d.linkedCloudId).filter(Boolean));

    let restored = 0;
    let hasMore = false;

    for (const doc of cloudDocs) {
      if (localCloudIds.has(doc.id)) continue;
      
      if (!tryReserveBulkWriteBudget()) {
        hasMore = true;
        break;
      }

      try {
        await CloudSyncService.addLocalCopy(userId, doc.id);
        restored++;
      } catch (err) {
        reportError(err, { action: 'restoreMissingDocuments_doc', cloudId: doc.id });
      }
    }

    return { restored, hasMore };
  },

  /**
   * Restores links a lost/failed cloud read destroyed (a note read as
   * "Cloud Copy Lost" and unlinked). Must run before anything uploads or
   * downloads: an unlinked note is re-uploaded as a NEW cloud document and
   * re-downloaded as a SECOND local copy, so the cost of skipping it is
   * duplicates, not just a missing badge.
   *
   * Reads the cloud only when there is something to re-link, and throws rather
   * than returning 0 when that read fails — "could not ask" must never reach a
   * caller as "nothing matched".
   */
  async relinkOrphanedDocuments(userId: string): Promise<number> {
    const localDocs = await LocalStorageService.getGuestDocuments(userId);
    if (!localDocs.some(isRelinkCandidate)) return 0;
    const cloudDocs = await DocumentService.getUserDocuments(userId);
    return relinkOrphaned(localDocs, cloudDocs);
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    const allLocal = await LocalStorageService.getGuestDocuments(userId);
    const existing = allLocal.find(d => d.linkedCloudId === cloudDocumentId);
    if (existing) return existing.id;

    const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
    if (!cloudDoc) throw new Error('Cloud document not found');

    const versions = await VersionService.getVersions(userId, cloudDocumentId);
    const firstSessionMs = toDate(cloudDoc.firstSessionAt)?.getTime() ?? undefined;
    const lastSessionMs = toDate(cloudDoc.lastSessionAt)?.getTime() ?? undefined;
    const localId = await LocalStorageService.createDocument(userId, {
      title: cloudDoc.title,
      tags: cloudDoc.tags,
      labelId: cloudDoc.labelId ?? undefined,
      firstSessionAt: firstSessionMs ?? undefined,
      lastSessionAt: lastSessionMs ?? undefined,
    });

    try {
      let prevContent = '';
      // Versions whose ciphertext could not be turned back into text. The local
      // store holds PLAINTEXT, so a failed decrypt must never be written to it:
      // `ver.content` is Base64 ciphertext, and saving it made the note read as
      // gibberish that the app cannot tell from real writing — it would reach
      // search, export, backups and the AI context.
      const corruptedVersions: number[] = [];
      const latestVersionNo = versions.reduce((max, v) => Math.max(max, v.version ?? 1), 0);

      for (const ver of versions) {
        let startedAt = toDate(ver.sessionStartedAt) ?? toDate(ver.savedAt) ?? new Date();
        if (isNaN(startedAt.getTime())) startedAt = new Date();

        const verRecord: Record<string, unknown> = { ...ver };
        let verContent: string | null = null;
        try {
          const decryptedVer = await maybeDecrypt(verRecord, ['content'], []);
          // A non-string here means the payload is not what we think it is —
          // treated as corrupt rather than falling back to the raw field.
          verContent = typeof decryptedVer.content === 'string' ? decryptedVer.content : null;
        } catch (decErr) {
          if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
          if (!(decErr instanceof DecryptionError)) throw decErr;
          verContent = null;
        }

        if (verContent === null) {
          corruptedVersions.push(ver.version ?? 1);
          continue;
        }

        await LocalVersionService.addVersion(userId, localId, {
          content: verContent,
          previousContent: prevContent,
          wordCount: ver.wordCount,
          duration: ver.duration,
          wpm: ver.wpm,
          versionNumber: ver.version ?? 1,
          goalWords: ver.goalWords,
          goalTime: ver.goalTime,
          goalReached: ver.goalReached,
          sessionStartedAt: startedAt,
          savedAt: ver.savedAt ? toDate(ver.savedAt) ?? undefined : undefined,
        });
        prevContent = verContent;
      }

      // The newest version is what the note IS. If it could not be read, importing
      // the rest would show older text as if it were current — worse than not
      // having the note here at all, because nothing tells the user. The catch
      // below deletes the half-built local document and rethrows.
      if (corruptedVersions.includes(latestVersionNo)) {
        throw new Error(`DECRYPT_FAILED_LATEST: cloud document ${cloudDocumentId} version ${latestVersionNo}`);
      }

      if (corruptedVersions.length > 0) {
        reportError(
          new Error(`Skipped ${corruptedVersions.length} unreadable version(s) while importing a note`),
          { action: 'addLocalCopy_corruptedVersions', cloudDocumentId, versions: corruptedVersions.join(',') },
          'warning',
        );
        useActivityLogStore.getState().addActivity(
          `Часть истории заметки не читается и пропущена (версий: ${corruptedVersions.length})`,
          { action: 'addLocalCopy_corruptedVersions', cloudDocumentId },
          'warning',
          'sync',
        );
      }

      await LocalStorageService.updateDocument(localId, {
        totalWords: cloudDoc.totalWords,
        totalDuration: cloudDoc.totalDuration,
        currentVersion: cloudDoc.currentVersion,
        sessionsCount: cloudDoc.sessionsCount ?? 1,
      });

      await LocalStorageService.updateLinkedCloudId(localId, cloudDocumentId);
      
      useActivityLogStore.getState().addActivity(
        'Заметка загружена из облака',
        { action: 'addLocalCopy', documentId: localId, cloudDocumentId },
        'success',
        'sync'
      );
    } catch (e) {
      reportError(e, { action: 'addLocalCopy', cloudDocumentId });
      try { await LocalStorageService.deleteDocument(localId); } catch (cleanupErr) {
        reportError(cleanupErr, { action: 'addLocalCopy_cleanup', localId });
      }
      throw e;
    }

    return localId;
  },

  async addCloudCopy(userId: string, localDocumentId: string, _encryptionRequired = true): Promise<string> {
    if (!isFirestoreConnected) {
      throw new Error('Not connected to cloud. Changes saved locally.');
    }
    if (areCloudWritesBlockedToday()) {
      return '';
    }
    const db = await getLocalDb();
    const lockKey = `lock_cloud_${localDocumentId}`;

    const lockTx = db.transaction('syncQueue', 'readwrite');
    const existing = await lockTx.store.get(lockKey);
    if (existing) {
      const age = Date.now() - (existing.createdAt ?? 0);
      if (age < LOCK_TTL_MS) {
        await lockTx.done;
        return '';
      }
    }
    await lockTx.store.put({ id: lockKey, documentId: localDocumentId, type: 'document' as const, createdAt: Date.now() });
    await lockTx.done;

    try {
      const localDoc = await LocalStorageService.getDocument(localDocumentId);
      if (!localDoc) throw new Error('Local document not found');

      if (localDoc.linkedCloudId) {
        const existingDoc = await withTimeout(DocumentService.getDocument(userId, localDoc.linkedCloudId));
        if (existingDoc) {
          // Already linked: push any LOCAL versions missing from the cloud and
          // refresh metadata. Previously this early-returned, so edits made after
          // the first sync never reached the cloud (doc stayed "Unsynced Edits").
          const cloudId = localDoc.linkedCloudId;
          const [localVersions, cloudVersions] = await Promise.all([
            LocalVersionService.getVersions(localDocumentId),
            withTimeout(VersionService.getVersions(userId, cloudId)),
          ]);
          const cloudNums = new Set(cloudVersions.map(v => v.version));
          let budgetExhausted = false;
          // Only versions NEWER than the newest the cloud holds. The cloud trims
          // old snapshots (pruneOldVersions), so an older version being absent
          // there is housekeeping, not a gap: re-uploading it would undo the
          // trim and pay the write quota to do it, every sync, forever.
          const newestCloud = cloudVersions.reduce((max, v) => Math.max(max, v.version ?? 0), 0);
          const missing = localVersions.filter(v => !cloudNums.has(v.version) && v.version > newestCloud);
          const limiter = pLimit(3);
          await Promise.all(missing.map((ver) => limiter(async () => {
            if (!tryReserveBulkWriteBudget()) { budgetExhausted = true; return; }
            const idx = localVersions.findIndex(v => v.id === ver.id);
            const prevContent = idx <= 0 ? '' : (localVersions[idx - 1]?.content ?? '');
            const startedAt = ver.sessionStartedAt != null
              ? new Date(ver.sessionStartedAt)
              : new Date(ver.savedAt || Date.now());
            if (isNaN(startedAt.getTime())) {
              throw new Error(`Invalid sessionStartedAt for version ${ver.id}`);
            }
            const versionPayload = await maybeEncrypt({
              content: ver.content,
              previousContent: prevContent,
              wordCount: ver.wordCount,
              duration: ver.duration,
              wpm: ver.wpm,
              versionNumber: ver.version,
              goalWords: ver.goalWords,
              goalTime: ver.goalTime,
              goalReached: ver.goalReached,
              sessionStartedAt: startedAt,
            } satisfies VersionEncryptPayload, ['content', 'previousContent'], [], userId);
            const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
            const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
            const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
            await withTimeout(VersionService.addVersion(userId, cloudId, {
              content,
              previousContent,
              wordCount: ver.wordCount,
              duration: ver.duration,
              wpm: ver.wpm,
              versionNumber: ver.version,
              goalWords: ver.goalWords,
              goalTime: ver.goalTime,
              goalReached: ver.goalReached,
              sessionStartedAt: startedAt,
              savedAt: ver.savedAt ? new Date(ver.savedAt) : undefined,
              _encrypted,
            }));
          })));
          // A run that ran out of write budget left versions behind. Advancing
          // currentVersion anyway told the cloud it holds text it never received,
          // and returning the id cleared the queue — so the gap became permanent
          // and the activity log said the note was saved. Report incomplete
          // instead: the link stays (the document exists, so a retry must not
          // create a second one) and the queue keeps the work.
          if (budgetExhausted) {
            reportError(new Error('Cloud sync incomplete: write budget exhausted'),
              { action: 'addCloudCopy_incomplete', documentId: localDocumentId }, 'warning');
            return '';
          }
          // Don't roll cloud metadata backward when the cloud copy is ahead of
          // this (behind) device — otherwise currentVersion regresses and a later
          // save can reuse a version number, overwriting a version via setDoc(`v${n}`).
          if (localDoc.currentVersion >= existingDoc.currentVersion) {
            await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
              totalWords: localDoc.totalWords,
              totalDuration: localDoc.totalDuration,
              currentVersion: localDoc.currentVersion,
              sessionsCount: localDoc.sessionsCount,
              lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
              mood: localDoc.mood,
            }));
          }
          return cloudId;
        }
        await LocalStorageService.updateLinkedCloudId(localDocumentId, '');
      }

      const versions = await LocalVersionService.getVersions(localDocumentId);
      const uploadedVersions = new Set<number>();
      let incomplete = false;
      let cloudId: string | null = null;

      try {
        cloudId = await withTimeout(DocumentService.createDocument(userId, {
          title: localDoc.title,
          tags: localDoc.tags,
          labelId: localDoc.labelId ?? undefined,
          firstSessionAt: localDoc.firstSessionAt ? new Date(localDoc.firstSessionAt) : undefined,
          lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
        }));

        const limiter = pLimit(3);
        await Promise.all(versions.map((ver, i) => limiter(async () => {
          if (!tryReserveBulkWriteBudget()) return;
          const prevContent = i === 0 ? '' : (versions[i - 1]?.content ?? '');
          const startedAt = ver.sessionStartedAt != null
            ? new Date(ver.sessionStartedAt)
            : new Date(ver.savedAt || Date.now());
          if (isNaN(startedAt.getTime())) {
            throw new Error(`Invalid sessionStartedAt for version ${ver.id}`);
          }

          const versionPayload = await maybeEncrypt({
            content: ver.content,
            previousContent: prevContent,
            wordCount: ver.wordCount,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
          } satisfies VersionEncryptPayload, ['content', 'previousContent'], [], userId);

          const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
          const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
          const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
          await withTimeout(VersionService.addVersion(userId, cloudId!, {
            content,
            previousContent,
            wordCount: ver.wordCount,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
            savedAt: ver.savedAt ? new Date(ver.savedAt) : undefined,
            _encrypted,
          }));
          uploadedVersions.add(ver.version);
        })));

        // What the cloud can honestly claim to hold. When the write budget ran
        // out mid-way, saying `localDoc.currentVersion` would advertise text
        // that never arrived — and the note would look fully backed up.
        const contiguous = highestContiguousVersion(versions.map(v => v.version), uploadedVersions);
        incomplete = uploadedVersions.size < versions.length;

        await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
          totalWords: localDoc.totalWords,
          totalDuration: localDoc.totalDuration,
          currentVersion: incomplete ? contiguous : localDoc.currentVersion,
          sessionsCount: localDoc.sessionsCount,
          lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
          mood: localDoc.mood,
        }));
      } catch (e) {
        if (isGlobalWriteFailure(e)) {
          blockCloudWritesToday();
        }
        if (cloudId) {
          try { await DocumentService.deleteDocument(userId, cloudId); } catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_cleanup', cloudId }); }
        }
        throw e;
      }

      if (!cloudId) throw new Error('Failed to create cloud document');
      // A concurrent tab (whose lock may have appeared to expire during a long
      // upload) could have created+linked a cloud doc meanwhile. If so, discard
      // our duplicate and adopt the winner rather than orphaning a cloud document.
      const freshLocal = await LocalStorageService.getDocument(localDocumentId);
      if (freshLocal?.linkedCloudId && freshLocal.linkedCloudId !== cloudId) {
        try { await DocumentService.deleteDocument(userId, cloudId); }
        catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_dupCleanup', cloudId }); }
        return freshLocal.linkedCloudId;
      }
      // The link is set even when the upload is incomplete: the cloud document
      // exists, and a retry that did not know about it would create a second one.
      await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId);
      await LocalStorageService.migrateDocumentOwner(localDocumentId, userId);

      if (incomplete) {
        reportError(new Error('Cloud sync incomplete: write budget exhausted'),
          { action: 'addCloudCopy_incomplete', documentId: localDocumentId, uploaded: uploadedVersions.size, total: versions.length }, 'warning');
        useActivityLogStore.getState().addActivity(
          `Заметка выгружена частично (версий: ${uploadedVersions.size} из ${versions.length}) — остальное уйдёт позже`,
          { action: 'addCloudCopy_incomplete', documentId: localDocumentId, cloudDocumentId: cloudId },
          'warning',
          'sync'
        );
        // Empty id: callers leave the queue item in place, so the rest is retried.
        return '';
      }

      useActivityLogStore.getState().addActivity(
        'Заметка сохранена в облако',
        { action: 'addCloudCopy', documentId: localDocumentId, cloudDocumentId: cloudId },
        'success',
        'sync'
      );
      
      return cloudId;
    } finally {
      try {
        const cleanupDb = await getLocalDb();
        await cleanupDb.delete('syncQueue', lockKey);
      } catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_lockCleanup', lockKey }); }
    }
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string, localDocumentId?: string): Promise<void> {
    await DocumentService.deleteDocument(userId, cloudDocumentId);
    if (localDocumentId) {
      await LocalStorageService.updateLinkedCloudId(localDocumentId, '');
    }
  },

  async getDocument(userId: string, cloudId: string) {
    return DocumentService.getDocument(userId, cloudId);
  },

  async syncVersionToCloud(
    userId: string,
    documentId: string,
    linkedCloudId: string,
    data: SaveDocumentData,
    newVersion: number,
    prevContent: string
  ): Promise<{ forked: boolean }> {
    if (!isFirestoreConnected) {
      const syncDb = await getLocalDb();
      await syncDb.put('syncQueue', {
        id: `sync_${documentId}`,
        documentId,
        type: 'document' as const,
        createdAt: Date.now(),
      });
      return { forked: false };
    }
    try {
      const cloudDoc = await DocumentService.getDocument(userId, linkedCloudId);
      if (!cloudDoc) {
        const syncDb = await getLocalDb();
        await syncDb.put('syncQueue', {
          id: `sync_${documentId}`,
          documentId,
          type: 'document' as const,
          createdAt: Date.now(),
        });
      } else if (cloudDoc.currentVersion >= newVersion) {
        const localDoc = await LocalStorageService.getDocument(documentId);
        const result = await ConflictResolver.resolveConflict(
          userId,
          documentId,
          linkedCloudId,
          data,
          newVersion,
          cloudDoc,
          localDoc?.firstSessionAt
        );
        return result;
      } else {
        const startedAt = data.sessionStartedAt;
        if (isNaN(startedAt.getTime())) {
          throw new Error('Invalid sessionStartedAt');
        }
        const versionPayload = await maybeEncrypt({
          content: data.content,
          previousContent: prevContent,
          wordCount: data.wordCount,
          duration: data.duration,
          wpm: data.wpm,
          versionNumber: newVersion,
          goalWords: data.goalWords,
          goalTime: data.goalTime,
          goalReached: data.goalReached,
          sessionStartedAt: startedAt,
          mood: data.mood,
        } satisfies VersionEncryptPayload, ['content', 'previousContent'], [], userId);
        const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
        const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
        const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
        await VersionService.addVersion(userId, linkedCloudId, {
          content,
          previousContent,
          wordCount: data.wordCount,
          duration: data.duration,
          wpm: data.wpm,
          versionNumber: newVersion,
          goalWords: data.goalWords,
          goalTime: data.goalTime,
          goalReached: data.goalReached,
          sessionStartedAt: startedAt,
          mood: data.mood,
          _encrypted,
        });
        await DocumentService.updateDocumentAfterSession(userId, linkedCloudId, {
          totalWords: data.documentWordCount ?? data.wordCount,
          totalDuration: data.duration,
          currentVersion: newVersion,
          mood: data.mood,
        });
        
        useActivityLogStore.getState().addActivity(
          'Изменения сохранены в облако',
          { action: 'syncVersionToCloud', documentId, newVersion },
          'success',
          'sync'
        );
      }
    } catch (e) {
      reportError(e, { action: 'syncVersionToCloud', documentId, linkedCloudId });
      try {
        const syncDb = await getLocalDb();
        await syncDb.put('syncQueue', {
          id: `sync_${documentId}`,
          documentId,
          type: 'document' as const,
          createdAt: Date.now(),
        });
      } catch (queueErr) {
        reportError(queueErr, { action: 'syncVersionToCloud_queueSync', documentId });
      }
    }
    return { forked: false };
  },

  /** Pushes the locally-cached AI profile portrait to Firestore. Lives here
   *  (not in features/ai) so the sync-queue drain (core/services/SyncService,
   *  which must not import from features/) can call it directly for queued
   *  'portrait' tasks. AIProfileService.syncPortraitToCloud delegates here. */
  async syncPortraitToCloud(userId: string): Promise<void> {
    const portraitMarkdown = localStorage.getItem(PORTRAIT_LS_KEY);
    if (!portraitMarkdown) return;

    const encrypted = await maybeEncrypt(
      { aiPortrait: portraitMarkdown },
      ['aiPortrait'],
      [],
      userId,
    );
    const { db, mod } = await getClient();
    await mod.setDoc(mod.doc(db, 'users', userId), encrypted, { merge: true });
  },
};

function isRelinkCandidate(doc: LocalDocument): boolean {
  return !doc.linkedCloudId && !doc.localOnly && !!doc.firstSessionAt;
}

/**
 * Pairs unlinked local notes back to their cloud copies on `firstSessionAt` —
 * the one field both copy directions carry over verbatim (addCloudCopy and
 * addLocalCopy each pass it straight into createDocument) and that only an
 * explicit date edit changes, which writes both sides together.
 *
 * Only unambiguous 1:1 matches are linked: two notes sharing a start timestamp
 * are left for the owner rather than guessed at. Mutates `localDocs` in place
 * so a caller that already holds the array sees the new links.
 */
async function relinkOrphaned(localDocs: LocalDocument[], cloudDocs: Document[]): Promise<number> {
  const candidates = localDocs.filter(isRelinkCandidate);
  if (candidates.length === 0) return 0;

  const takenCloudIds = new Set(localDocs.map(d => d.linkedCloudId).filter(Boolean));
  const localsByStart = new Map<number, LocalDocument[]>();
  for (const doc of candidates) {
    const group = localsByStart.get(doc.firstSessionAt);
    if (group) group.push(doc); else localsByStart.set(doc.firstSessionAt, [doc]);
  }

  const cloudByStart = new Map<number, Document[]>();
  for (const cloudDoc of cloudDocs) {
    if (takenCloudIds.has(cloudDoc.id)) continue;
    const start = toDate(cloudDoc.firstSessionAt)?.getTime();
    if (start == null || isNaN(start) || !localsByStart.has(start)) continue;
    const group = cloudByStart.get(start);
    if (group) group.push(cloudDoc); else cloudByStart.set(start, [cloudDoc]);
  }

  let relinked = 0;
  for (const [start, locals] of localsByStart) {
    const cloudMatches = cloudByStart.get(start);
    const local = locals[0];
    const cloudDoc = cloudMatches?.[0];
    if (locals.length !== 1 || cloudMatches?.length !== 1 || !local || !cloudDoc) continue;
    await LocalStorageService.updateLinkedCloudId(local.id, cloudDoc.id);
    local.linkedCloudId = cloudDoc.id;
    relinked++;
  }

  if (relinked > 0) {
    useActivityLogStore.getState().addActivity(
      `Заметки заново связаны с облачными копиями: ${relinked}`,
      { action: 'relinkOrphanedDocuments', relinked },
      'success',
      'sync'
    );
  }
  return relinked;
}
