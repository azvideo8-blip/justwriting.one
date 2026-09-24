import { DocumentService } from './DocumentService';
import { requeueDocumentTask } from '../sync/requeueDocumentTask';
import { VersionService } from './VersionService';
import { LocalStorageService } from './LocalStorageService';
import { syncStatusOf } from '../sync/syncStatus';
import { isPoisonSyncError } from '../sync/classifySyncError';
import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb, type LocalDocument } from '../storage/localDb';
import { Document } from '../../types';
import { toDate } from '../utils/dateUtils';
import { maybeEncrypt, maybeDecrypt, DecryptionError, type VersionEncryptPayload, getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { getSessionKey } from '../crypto/encrypt';
import { reportError } from '../../shared/errors/reportError';
import { withTimeout as withTimeoutBase } from '../../shared/utils/withTimeout';

import { DataProvider } from '../data';

import { SaveDocumentData } from './storageTypes';
import { ConflictResolver } from './ConflictResolver';
import { useActivityLogStore } from '../../shared/activity/useActivityLogStore';
import { computeWordDelta } from './DiffService';
import { comparableOrUnknown } from '../sync/comparableOrUnknown';
import { withDocumentLock } from '../sync/withDocumentLock';
import { logger } from '../../shared/errors/logger';
import pLimit from 'p-limit';

import { getActiveEditorDocumentId } from '../sync/activeEditor';

const _activeDownloadPromises = new Map<string, Promise<{ downloaded: number; skipped: number; failed: number; locked?: boolean }>>();
const _activeReconcilePromises = new Map<string, Promise<{ reconciled: number; skipped: number; failed: number; locked?: boolean }>>();
const downloadLimit = pLimit(5);

export interface RelinkResult {
  relinked: number;
  skippedIds: string[];
}

export const CLOUD_COPY_LOCAL_ONLY = 'LOCAL_ONLY';
export const CLOUD_COPY_TOMBSTONE = 'TOMBSTONE';

const CLOUD_SYNC_TIMEOUT = 30_000;

/**
 * Снять задачи очереди, относящиеся к заметке.
 *
 * Правило одно: задача принадлежит заметке, если совпал её documentId или это
 * задача с именем `sync_<id>`. Раньше оно жило тремя копиями в этом файле, и
 * копии успели разойтись — одна из них знала только про documentId.
 */
async function dropQueueTasksFor(localDocumentId: string): Promise<void> {
  try {
    const db = await getLocalDb();
    const tx = db.transaction('syncQueue', 'readwrite');
    const all = await tx.store.getAll();
    for (const t of all) {
      if (t.documentId === localDocumentId || t.id === `sync_${localDocumentId}`) {
        await tx.store.delete(t.id);
      }
    }
    await tx.done;
  } catch { /* очередь переживёт лишнюю задачу; потеря заметки — нет */ }
}

function withTimeout<T>(promise: Promise<T>, ms: number = CLOUD_SYNC_TIMEOUT): Promise<T> {
  return withTimeoutBase(promise, ms, 'Sync timeout');
}



export const CloudSyncService = {
  async restoreMissingDocuments(
    userId: string,
    opts?: { force?: boolean; onProgress?: (current: number, total: number) => void },
  ): Promise<{ restored: number; hasMore: boolean; locked?: boolean; throttled?: boolean }> {
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { restored: 0, hasMore: false, locked: true };
    }

    if (!opts?.force) {
      const lastListingTs = parseInt(localStorage.getItem(`last_restore_listing_ts_${userId}`) || '0', 10);
      if (Date.now() - lastListingTs < 30 * 60 * 1000) {
        return { restored: 0, hasMore: false, throttled: true };
      }
    }
    
    // We update the timestamp only if we are actually going to list.
    localStorage.setItem(`last_restore_listing_ts_${userId}`, Date.now().toString());

    const res = await CloudSyncService.downloadAllFromCloud(userId, opts?.onProgress ? { onProgress: opts.onProgress } : undefined);
    return {
      restored: res.downloaded,
      hasMore: false,
      ...(res.locked !== undefined ? { locked: res.locked } : {}),
    };
  },

  /**
   * S-1: one download at a time per user, whichever entry point started it
   * (auth mount, online recovery, vault unlock, the settings button, the daily
   * background restore). A second caller joins the running promise.
   */
  async downloadAllFromCloud(
    userId: string,
    opts?: { onProgress?: (current: number, total: number) => void }
  ): Promise<{ downloaded: number; skipped: number; failed: number; locked?: boolean }> {
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { downloaded: 0, skipped: 0, failed: 0, locked: true };
    }

    const active = _activeDownloadPromises.get(userId);
    if (active) return active;

    const run = async () => {
      // S-2: Do NOT catch relinkOrphanedDocuments error here. A download that could not relink must stop.
      await CloudSyncService.relinkOrphanedDocuments(userId);

      const [cloudDocs, localDocs] = await Promise.all([
        DocumentService.getUserDocuments(userId),
        LocalStorageService.getDocumentsByOwner(userId),
      ]);

      const linkedCloudMap = new Map(localDocs.filter(d => d.linkedCloudId).map(d => [d.linkedCloudId!, d]));
      const localUuidSet = new Set(localDocs.map(d => d.uuid).filter(Boolean));
      // S-2: The uuid check is the second line of defence. It does not cover documents
      // created before UUID backfill; for those, relinkOrphanedDocuments above is the sole protection.
      const toDownload = cloudDocs.filter(d => !linkedCloudMap.has(d.id) && (!d.uuid || !localUuidSet.has(d.uuid)));
      let skipped = cloudDocs.length - toDownload.length;

      const downloadResults = await Promise.allSettled(
        toDownload.map((cloudDoc, idx) => downloadLimit(async () => {
          opts?.onProgress?.(idx + 1, toDownload.length);
          return CloudSyncService.addLocalCopy(userId, cloudDoc.id);
        }))
      );

      let downloaded = 0;
      let failed = 0;
      for (const r of downloadResults) {
        if (r.status === 'fulfilled') downloaded++;
        else {
          const reasonStr = String((r.reason as { message?: string })?.message || r.reason);
          if (reasonStr.startsWith('LOCK_HELD') || reasonStr.includes('LOCK_HELD')) {
            skipped++;
            logger.info('downloadAllFromCloud', 'Download already in progress in another tab', { reason: reasonStr });
          } else {
            failed++;
            logger.error('downloadAllFromCloud', 'Download failed', { reason: String(r.reason) });
          }
        }
      }

      if (downloaded > 0) {
        useActivityLogStore.getState().addActivity(
          `Загружено заметок из облака: ${downloaded}`,
          { action: 'downloadAllFromCloud', downloaded, skipped, failed },
          'info',
          'sync'
        );
      }

      return { downloaded, skipped, failed };
    };

    const promise = run();
    _activeDownloadPromises.set(userId, promise);
    try {
      return await promise;
    } finally {
      _activeDownloadPromises.delete(userId);
    }
  },

  /**
   * SYNC-CURSOR-3: Policy B linked-note reconciliation.
   *
   * For each local document with linkedCloudId where the cloud copy is newer:
   * - No pending local edit (and note not open in active editor): silent fast-forward.
   * - Pending local edit exists (or note open in editor): keep on-screen content intact,
   *   fetch incoming cloud version and write as an additional entry in version history,
   *   and log exactly one activity log entry.
   */
  async reconcileLinkedDocuments(
    userId: string,
    opts?: { getActiveDocumentId?: () => string | null }
  ): Promise<{ reconciled: number; skipped: number; failed: number; locked?: boolean }> {
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { reconciled: 0, skipped: 0, failed: 0, locked: true };
    }

    const active = _activeReconcilePromises.get(userId);
    if (active) return active;

    const run = async () => {
      const pendingDocIds = new Set<string>();
      try {
        const db = await getLocalDb();
        const queue = await db.getAll('syncQueue');
        for (const item of queue) {
          if (item.documentId && !item.id.startsWith('lock_cloud_')) {
            pendingDocIds.add(item.documentId);
          }
        }
      } catch (err) {
        reportError(err, { action: 'reconcileLinkedDocuments_syncQueue' });
      }

      const activeEditorDocId = opts?.getActiveDocumentId ? opts.getActiveDocumentId() : getActiveEditorDocumentId();

      const [localDocs, cloudDocs] = await Promise.all([
        LocalStorageService.getDocumentsByOwner(userId),
        DocumentService.getUserDocuments(userId),
      ]);

      const cloudDocMap = new Map(cloudDocs.map(cd => [cd.id, cd]));
      const linkedLocalDocs = localDocs.filter(d => Boolean(d.linkedCloudId) && d.localOnly !== true && cloudDocMap.has(d.linkedCloudId!));

      let reconciled = 0;
      let skipped = 0;
      let failed = 0;

      for (const localDoc of linkedLocalDocs) {
        const cloudDoc = cloudDocMap.get(localDoc.linkedCloudId!)!;
        const cloudTime = cloudDoc.updatedAt ? new Date(cloudDoc.updatedAt).getTime() : (cloudDoc.createdAt ? new Date(cloudDoc.createdAt).getTime() : 0);
        const localSeenTime = localDoc.lastSeenCloudUpdatedAt ? new Date(localDoc.lastSeenCloudUpdatedAt).getTime() : 0;

        const isCloudNewer = localSeenTime > 0
          ? cloudTime > localSeenTime
          : (cloudDoc.currentVersion > (localDoc.lastSyncedCloudVersion ?? localDoc.currentVersion) ||
             (cloudTime > (localDoc.lastSessionAt || 0) && cloudDoc.currentVersion >= localDoc.currentVersion));

        if (!isCloudNewer) {
          skipped++;
          continue;
        }

        try {
          await withDocumentLock(localDoc.id, async () => {
            const isPending = pendingDocIds.has(localDoc.id) || (activeEditorDocId === localDoc.id);

            const cloudVersions = await VersionService.getVersions(userId, localDoc.linkedCloudId!);
            if (!cloudVersions.length) {
              skipped++;
              return;
            }

            const cloudUpdatedAtIso = cloudDoc.updatedAt
              ? new Date(cloudDoc.updatedAt).toISOString()
              : new Date(cloudTime || Date.now()).toISOString();

            if (isPending) {
              const latestCloudVer = cloudVersions.reduce((latest, v) => (v.version > latest.version ? v : latest), cloudVersions[0]!);

              let plainContent: string | null = null;
              let plainMood: string | undefined = undefined;
              try {
                const decrypted = await maybeDecrypt(latestCloudVer as unknown as Record<string, unknown>, ['content', 'mood'], []);
                plainContent = typeof decrypted.content === 'string' ? decrypted.content : null;
                plainMood = typeof decrypted.mood === 'string' ? decrypted.mood : (typeof latestCloudVer.mood === 'string' ? latestCloudVer.mood : undefined);
              } catch (decErr) {
                if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
                if (!(decErr instanceof DecryptionError)) throw decErr;
              }

              if (plainContent !== null) {
                const localVersions = await LocalVersionService.getVersions(localDoc.id);
                const nextVersionNo = Math.max(...localVersions.map(v => v.version), 0) + 1;

                await LocalVersionService.addVersion(userId, localDoc.id, {
                  content: plainContent,
                  previousContent: '',
                  wordCount: latestCloudVer.wordCount ?? 0,
                  duration: latestCloudVer.duration ?? 0,
                  wpm: latestCloudVer.wpm ?? 0,
                  versionNumber: nextVersionNo,
                  goalWords: latestCloudVer.goalWords,
                  goalTime: latestCloudVer.goalTime,
                  goalReached: latestCloudVer.goalReached,
                  sessionStartedAt: latestCloudVer.sessionStartedAt ? toDate(latestCloudVer.sessionStartedAt) ?? new Date() : new Date(),
                  savedAt: latestCloudVer.savedAt ? toDate(latestCloudVer.savedAt) ?? undefined : undefined,
                  mood: plainMood,
                });

                useActivityLogStore.getState().addActivity(
                  'заметка изменилась на другом устройстве',
                  { action: 'reconcileLinkedDocuments_remote_edit', documentId: localDoc.id, cloudDocumentId: localDoc.linkedCloudId },
                  'info',
                  'sync',
                );

                const db = await getLocalDb();
                const cur = await db.get('documents', localDoc.id);
                if (cur) {
                  await db.put('documents', {
                    ...cur,
                    lastSeenCloudUpdatedAt: cloudUpdatedAtIso,
                  });
                }
                reconciled++;
              }
            } else {
              const localVersions = await LocalVersionService.getVersions(localDoc.id);
              const localVerSet = new Set(localVersions.map(v => v.version));

              const sortedCloudVersions = [...cloudVersions].sort((a, b) => a.version - b.version);
              let prevContent = '';
              for (const cv of sortedCloudVersions) {
                let cContent: string | null = null;
                let cMood: string | undefined = undefined;
                try {
                  const dec = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content', 'mood'], []);
                  cContent = typeof dec.content === 'string' ? dec.content : null;
                  cMood = typeof dec.mood === 'string' ? dec.mood : (typeof cv.mood === 'string' ? cv.mood : undefined);
                } catch (decErr) {
                  if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
                  if (!(decErr instanceof DecryptionError)) throw decErr;
                }

                if (cContent !== null) {
                  if (!localVerSet.has(cv.version)) {
                    await LocalVersionService.addVersion(userId, localDoc.id, {
                      content: cContent,
                      previousContent: prevContent,
                      wordCount: cv.wordCount ?? 0,
                      duration: cv.duration ?? 0,
                      wpm: cv.wpm ?? 0,
                      versionNumber: cv.version,
                      goalWords: cv.goalWords,
                      goalTime: cv.goalTime,
                      goalReached: cv.goalReached,
                      sessionStartedAt: cv.sessionStartedAt ? toDate(cv.sessionStartedAt) ?? new Date() : new Date(),
                      savedAt: cv.savedAt ? toDate(cv.savedAt) ?? undefined : undefined,
                      mood: cMood,
                    });
                  }
                  prevContent = cContent;
                }
              }

              await LocalStorageService.updateDocument(localDoc.id, {
                title: cloudDoc.title ?? localDoc.title,
                tags: cloudDoc.tags ?? localDoc.tags,
                labelId: cloudDoc.labelId !== undefined ? (cloudDoc.labelId ?? undefined) : localDoc.labelId,
                mood: cloudDoc.mood ?? localDoc.mood,
                currentVersion: cloudDoc.currentVersion,
                totalWords: cloudDoc.totalWords ?? localDoc.totalWords,
                totalDuration: cloudDoc.totalDuration ?? localDoc.totalDuration,
                sessionsCount: cloudDoc.sessionsCount ?? localDoc.sessionsCount,
                lastSyncedCloudVersion: cloudDoc.currentVersion,
                lastSeenCloudUpdatedAt: cloudUpdatedAtIso,
                excludedFromAI: cloudDoc.excludedFromAI ?? localDoc.excludedFromAI,
                // R3-5: корзина на другом устройстве (и восстановление из неё) —
                // облако новее, значит его состояние корзины и есть последнее.
                trashedAt: toDate((cloudDoc as { trashedAt?: unknown }).trashedAt)?.getTime() ?? null,
              });

              reconciled++;
            }
          }, { queueOnHeld: false });
        } catch (err) {
          const msg = String((err as { message?: string })?.message || err);
          if (msg.startsWith('LOCK_HELD') || msg.includes('LOCK_HELD')) {
            skipped++;
          } else {
            failed++;
            reportError(err, { action: 'reconcileLinkedDocuments_doc', docId: localDoc.id });
          }
        }
      }

      return { reconciled, skipped, failed };
    };

    const promise = run();
    _activeReconcilePromises.set(userId, promise);
    try {
      return await promise;
    } finally {
      _activeReconcilePromises.delete(userId);
    }
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
  async relinkOrphanedDocuments(userId: string): Promise<RelinkResult> {
    const localDocs = await LocalStorageService.getDocumentsByOwner(userId);
    if (!localDocs.some(hasRelinkWork)) return { relinked: 0, skippedIds: [] };
    const cloudDocs = await DocumentService.getUserDocuments(userId);
    return relinkOrphaned(localDocs, cloudDocs);
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    return withDocumentLock(cloudDocumentId, async () => {
      const allLocal = await LocalStorageService.getDocumentsByOwner(userId);
      const existing = allLocal.find(d => d.linkedCloudId === cloudDocumentId);
      if (existing) return existing.id;

      const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
      if (!cloudDoc) throw new Error('Cloud document not found');
      if (cloudDoc._locked) throw new Error('LOCKED: cannot add local copy of locked document');
      if (cloudDoc._decryptionError) throw new Error('DECRYPTION_ERROR: cannot add local copy of unreadable document');

      // S-5: Check versions before creating a local document.
      // If the cloud document has 0 versions, do not create a zero-version local orphan.
      const versions = await VersionService.getVersions(userId, cloudDocumentId);
      if (!versions.length) {
        throw new Error('EMPTY_CLOUD_DOCUMENT: Cloud document has no versions');
      }

      const firstSessionMs = toDate(cloudDoc.firstSessionAt)?.getTime() ?? undefined;
      const lastSessionMs = toDate(cloudDoc.lastSessionAt)?.getTime() ?? undefined;

      let localId: string | undefined;

      try {
        localId = await LocalStorageService.createDocument(userId, {
          title: cloudDoc.title ?? '',
          tags: cloudDoc.tags ?? [],
          labelId: cloudDoc.labelId ?? undefined,
          firstSessionAt: firstSessionMs ?? undefined,
          lastSessionAt: lastSessionMs ?? undefined,
          mood: cloudDoc.mood,
          excludedFromAI: cloudDoc.excludedFromAI,
        });

        // S-1: Accept canonical uuid from the cloud doc inside the try block
        // so that a unique constraint collision cleans up the localId properly.
        // R3-5: заметка в корзине приезжает в корзину — раньше пометка терялась,
        // и на втором устройстве заметка становилась обычной (и снова шла в ИИ).
        const cloudTrashedAt = toDate((cloudDoc as { trashedAt?: unknown }).trashedAt)?.getTime();
        if (cloudDoc.uuid || cloudTrashedAt) {
          const db = await getLocalDb();
          const tx = db.transaction('documents', 'readwrite');
          const localDoc = await tx.store.get(localId);
          if (localDoc) {
            await tx.store.put({
              ...localDoc,
              ...(cloudDoc.uuid ? { uuid: cloudDoc.uuid } : {}),
              ...(cloudTrashedAt ? { trashedAt: cloudTrashedAt } : {}),
            });
          }
          await tx.done;
        }

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
          let verMood: string | undefined = undefined;
          try {
            const decryptedVer = await maybeDecrypt(verRecord, ['content', 'mood'], []);
            // A non-string here means the payload is not what we think it is —
            // treated as corrupt rather than falling back to the raw field.
            verContent = typeof decryptedVer.content === 'string' ? decryptedVer.content : null;
            verMood = typeof decryptedVer.mood === 'string' ? decryptedVer.mood : (typeof ver.mood === 'string' ? ver.mood : undefined);
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
            mood: verMood,
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
          lastSyncedCloudVersion: cloudDoc.currentVersion,
          lastSeenCloudUpdatedAt: cloudDoc.updatedAt ? new Date(cloudDoc.updatedAt).toISOString() : (cloudDoc.createdAt ? new Date(cloudDoc.createdAt).toISOString() : new Date().toISOString()),
        });

        await LocalStorageService.updateLinkedCloudId(localId, cloudDocumentId);
        
        useActivityLogStore.getState().addActivity(
          'Заметка загружена из облака',
          { action: 'addLocalCopy', documentId: localId, cloudDocumentId },
          'success',
          'sync'
        );

        return localId;
      } catch (e) {
        reportError(e, { action: 'addLocalCopy', cloudDocumentId });
        if (localId) {
          try { await LocalStorageService.deleteDocument(localId); } catch (cleanupErr) {
            reportError(cleanupErr, { action: 'addLocalCopy_cleanup', localId });
          }
        }
        throw e;
      }
    // queueOnHeld: false — the lock key here is a CLOUD id. The default would
    // enqueue `sync_<cloudId>` as a document task, and the drain would then try
    // to addCloudCopy a local document that does not exist (ten failed attempts,
    // then quarantine). A second downloader simply fails with LOCK_HELD.
    }, { queueOnHeld: false });
  },

  async addCloudCopy(userId: string, localDocumentId: string, _encryptionRequired = true): Promise<string> {
    if (!navigator.onLine) {
      throw new Error('Not connected to cloud. Changes saved locally.');
    }

    return withDocumentLock(
      localDocumentId,
      async () => {
        const localDoc = await LocalStorageService.getDocument(localDocumentId);
      if (!localDoc) throw new Error('Local document not found');
      if (localDoc._locked || localDoc._decryptionError) {
        throw new Error('LOCKED: cannot add cloud copy of locked document');
      }
      if (localDoc.localOnly && !localDoc.unlinkedByTombstone) {
        await dropQueueTasksFor(localDocumentId);
        // Кнопка, которая ничего не делает и молчит, читается как поломка.
        // Отказ здесь законный, но человек должен узнать причину.
        useActivityLogStore.getState().addActivity(
          'Заметка помечена «только на устройстве» — в облако не отправлена',
          { action: 'addCloudCopy_localOnly', documentId: localDocumentId },
          'warning',
          'sync',
        );
        return CLOUD_COPY_LOCAL_ONLY;
      }

      if (localDoc.linkedCloudId) {
        const getDoc = DocumentService.getDocumentWithDeleted?.bind(DocumentService) ?? DocumentService.getDocument.bind(DocumentService);
        const existingDoc = await withTimeout(getDoc(userId, localDoc.linkedCloudId));
        if (existingDoc) {
          if (existingDoc.deletedAt) {
            // AUDIT-H3: заметка удалена в облаке. Unlink с флагом localOnly:
            // иначе следующий syncAllUnlinked зальёт её как НОВЫЙ облачный
            // документ и удаление «воскреснет» под другим id.
            await LocalDocumentService.unlinkFromCloud(localDocumentId, 'tombstone');
            await dropQueueTasksFor(localDocumentId);
            useActivityLogStore.getState().addActivity(
              'Облачная копия этой заметки была удалена. Заметка осталась на устройстве; повторное «отправить в облако» создаст новую облачную копию',
              { action: 'addCloudCopy_tombstone', documentId: localDocumentId },
              'warning',
              'sync',
            );
            return CLOUD_COPY_TOMBSTONE;
          }
          if (existingDoc._locked) throw new Error('LOCKED: cannot sync to locked cloud document');
          if (existingDoc._decryptionError) throw new Error('DECRYPTION_ERROR: cannot sync to unreadable cloud document');
          // Already linked: pull missing cloud versions down, push any LOCAL versions missing from the cloud
          const cloudId = localDoc.linkedCloudId;
          const [localVersions, cloudVersions] = await Promise.all([
            LocalVersionService.getVersions(localDocumentId),
            withTimeout(VersionService.getVersions(userId, cloudId)),
          ]);
          const decryptedCloudVersions = await Promise.all(cloudVersions.map(async (cv) => {
            if (!cv._encrypted) return cv;
            try {
              const plain = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content', 'mood'], []);
              return {
                ...cv,
                content: typeof plain.content === 'string' ? plain.content : cv.content,
                mood: typeof plain.mood === 'string' ? plain.mood : cv.mood,
                _encrypted: false,
              };
            } catch (decErr) {
              if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
              if (!(decErr instanceof DecryptionError)) throw decErr;
              reportError(decErr, { action: 'addCloudCopy_decrypt', cloudId, version: cv.version });
              return { ...cv, _decryptionError: true };
            }
          }));
          const cloudVerMap = new Map(decryptedCloudVersions.map(v => [v.version, v]));
          const localVerMap = new Map(localVersions.map(v => [v.version, v]));
          const newestCloud = cloudVersions.reduce((max, v) => Math.max(max, v.version ?? 0), 0);
          const oldestCloud = cloudVersions.length > 0
            ? cloudVersions.reduce((min, v) => Math.min(min, v.version ?? 0), Infinity)
            : 0;

          // 1. Pull missing cloud versions down to local
          for (const cv of decryptedCloudVersions) {
            if (localVerMap.has(cv.version)) continue;
            if (cv._decryptionError) continue;

            await LocalVersionService.addVersion(userId, localDocumentId, {
              content: cv.content || '',
              previousContent: '',
              wordCount: cv.wordCount,
              duration: cv.duration,
              wpm: cv.wpm,
              versionNumber: cv.version,
              sessionStartedAt: cv.sessionStartedAt ?? new Date(),
              savedAt: cv.savedAt ?? undefined,
              mood: cv.mood,
            });
          }

          // 2. Identify local versions missing from cloud, or colliding with different content
          const missing: typeof localVersions = [];
          // AUDIT-MH5: коллизии собираем все, форк — ОДИН на документ.
          const collisions: typeof localVersions = [];
          let hasUnreadableVersion = false;
          for (const ver of localVersions) {
            const cloudVer = cloudVerMap.get(ver.version);
            if (!cloudVer) {
              // Older snapshots below oldestCloud were pruned by cloud housekeeping.
              // Any missing version within [oldestCloud, newestCloud] is a genuine gap.
              if (ver.version >= oldestCloud || cloudVersions.length === 0) {
                if (ver.version < newestCloud) {
                  reportError(
                    new Error(`Cloud version history gap detected: missing v${ver.version}`),
                    { action: 'addCloudCopy_versionGap', cloudId, missingVersion: ver.version, oldestCloud, newestCloud },
                    'warning',
                  );
                }
                missing.push(ver);
              }
            } else {
              // AG-CORRUPT-3: Refuse to declare divergence when unreadable (ciphertext vs plaintext, etc.)
              const comp = comparableOrUnknown(cloudVer, ver);
              if (!comp.comparable) {
                hasUnreadableVersion = true;
                continue;
              }
              if (!comp.same) {
                // Same version number, but DIFFERENT content! Fork to preserve local edits
                collisions.push(ver);
              }
            }
          }
          if (hasUnreadableVersion) {
            await requeueDocumentTask(localDocumentId, userId);
            useActivityLogStore.getState().addActivity(
              'Синхронизация отложена: невозможно расшифровать или сравнить облачную версию',
              { action: 'addCloudCopy_unreadableCloudVersion', documentId: localDocumentId, cloudId },
              'warning',
              'sync',
            );
            throw new Error('SYNC_UNRESOLVED: unreadable cloud version cannot be compared');
          }
          if (collisions.length > 0) {
            // N2-8: версии после первой коллизии построены на локальной ветке, а не
            // на облачной. В оригинал их не выгружаем — они уходят в форк вместе с
            // коллизией; иначе облачная история перемешивала две ветки.
            const firstCollision = Math.min(...collisions.map(v => v.version));
            for (let i = missing.length - 1; i >= 0; i--) {
              if (missing[i]!.version > firstCollision) missing.splice(i, 1);
            }
            const last = collisions[collisions.length - 1]!;
            await ConflictResolver.resolveConflict(
              userId,
              localDocumentId,
              cloudId,
              {
                title: localDoc.title,
                content: last.content,
                tags: localDoc.tags,
                wordCount: last.wordCount,
                duration: last.duration,
                wpm: last.wpm,
                sessionStartedAt: last.sessionStartedAt ? new Date(last.sessionStartedAt) : new Date(),
                labelId: localDoc.labelId,
                mood: last.mood,
              },
              last.version,
              existingDoc,
              localDoc.firstSessionAt ? new Date(localDoc.firstSessionAt).getTime() : undefined
            );
          }
          // N2-9: после форка оригинал приведён к облаку (счётчики, номер версии) —
          // метаданные ниже берём у него, а не у снимка до форка: иначе в облако
          // уходил currentVersion ветки, которая ушла в форк (cv4 при трёх
          // версиях), и следующая правка другого устройства не двигала облако
          // «вперёд» — её никто больше не видел.
          const metaDoc = collisions.length > 0
            ? (await LocalStorageService.getDocument(localDocumentId)) ?? localDoc
            : localDoc;
          missing.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
          for (const ver of missing) {
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
              mood: ver.mood,
            } satisfies VersionEncryptPayload, ['content', 'previousContent', 'mood'], [], userId);
            const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
            const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
            const mood = typeof versionPayload.mood === 'string' ? versionPayload.mood : ver.mood;
            const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
            await withTimeout(VersionService.addVersion(userId, cloudId, {
              content,
              previousContent,
              wordCount: ver.wordCount,
              wordsAdded: ver.wordsAdded,
              charsAdded: ver.charsAdded,
              duration: ver.duration,
              wpm: ver.wpm,
              versionNumber: ver.version,
              goalWords: ver.goalWords,
              goalTime: ver.goalTime,
              goalReached: ver.goalReached,
              sessionStartedAt: startedAt,
              savedAt: ver.savedAt ? new Date(ver.savedAt) : undefined,
              mood,
              _encrypted,
            }));
          }
          // A run that ran out of write budget left versions behind. Advancing
          // currentVersion anyway told the cloud it holds text it never received,
          // and returning the id cleared the queue — so the gap became permanent
          // and the activity log said the note was saved. Report incomplete
          // instead: the link stays (the document exists, so a retry must not
          // create a second one) and the queue keeps the work.

          // Don't roll cloud metadata backward when the cloud copy is ahead of
          // this (behind) device — otherwise currentVersion regresses and a later
          // save can reuse a version number, overwriting a version via setDoc(`v${n}`).
          // R3-1: неудавшаяся правка метаданных — дослать целиком. Счётчики ниже их
          // не несут, а задачу из очереди дренаж снимает при любом cloudId.
          if (localDoc.metadataDirty) {
            await withTimeout(DocumentService.updateMetadata(userId, cloudId, {
              title: localDoc.title,
              tags: localDoc.tags ?? [],
              labelId: localDoc.labelId,
              excludedFromAI: localDoc.excludedFromAI,
              lastSessionAt: localDoc.lastSessionAt,
              trashedAt: localDoc.trashedAt ?? null,
            }));
            await LocalDocumentService.setMetadataDirty(localDocumentId, false);
          } else if (missing.length > 0 && !localDoc.trashedAt && (existingDoc as { trashedAt?: unknown }).trashedAt) {
            // N2-2: заметку положили в корзину на другом устройстве, а здесь в неё
            // дописали. Свежий текст важнее корзины: возвращаем заметку, иначе
            // устройства расходятся — здесь она живая, там в корзине.
            await withTimeout(DocumentService.restoreDocument(userId, cloudId));
            useActivityLogStore.getState().addActivity(
              'Заметка была в корзине на другом устройстве — после вашей правки она восстановлена',
              { action: 'addCloudCopy_restoredFromTrash', documentId: localDocumentId },
              'info',
              'sync',
            );
          }
          if (metaDoc.currentVersion >= existingDoc.currentVersion) {
            await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
              totalWords: metaDoc.totalWords,
              totalDuration: metaDoc.totalDuration,
              currentVersion: metaDoc.currentVersion,
              sessionsCount: metaDoc.sessionsCount,
              lastSessionAt: metaDoc.lastSessionAt ? new Date(metaDoc.lastSessionAt) : undefined,
              mood: metaDoc.mood,
            }));
          }
          const syncdVer = Math.max(metaDoc.currentVersion, existingDoc.currentVersion);
          try {
            const db = await getLocalDb();
            const cur = await db.get('documents', localDocumentId);
            if (cur) await db.put('documents', { ...cur, lastSyncedCloudVersion: syncdVer, lastSeenCloudUpdatedAt: new Date().toISOString() });
          } catch { /* ignore */ }
          return cloudId;
        }
        await LocalStorageService.updateLinkedCloudId(localDocumentId, '');
      }

      const versions = await LocalVersionService.getVersions(localDocumentId);

      let cloudId: string | null = null;

      const createPayload = {
        title: localDoc.title,
        tags: localDoc.tags,
        labelId: localDoc.labelId ?? undefined,
        uuid: localDoc.uuid,
        firstSessionAt: localDoc.firstSessionAt ? new Date(localDoc.firstSessionAt) : undefined,
        lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
        // Колонки в облаке есть, а сюда их не клали: «не показывать ИИ»
        // терялось при первой же выгрузке и не возвращалось никогда.
        mood: localDoc.mood,
        excludedFromAI: localDoc.excludedFromAI,
        trashedAt: localDoc.trashedAt ? new Date(localDoc.trashedAt) : undefined,
        currentVersion: localDoc.currentVersion ?? (versions.length > 0 ? versions.length : 1),
        totalWords: localDoc.totalWords,
        totalDuration: localDoc.totalDuration,
        sessionsCount: localDoc.sessionsCount,
      };

      try {
        cloudId = await withTimeout(DocumentService.createDocument(userId, createPayload));
      } catch (createErr: unknown) {
        const is23505 =
          (createErr !== null && typeof createErr === 'object' && 'code' in createErr && (createErr as { code: string }).code === '23505') ||
          (createErr instanceof Error && /23505|documents_uuid_key|duplicate key/i.test(createErr.message));

        const localDocUuid = localDoc.uuid;
        if (Boolean(is23505) && typeof localDocUuid === 'string' && localDocUuid.length > 0) {
          // Check for genuine duplicate: another local document claiming this UUID
          const allLocal = await LocalStorageService.getDocumentsByOwner(userId);
          const conflictingLocal = allLocal.find(d => d.id !== localDocumentId && (d.uuid === localDocUuid || d.linkedCloudId === localDocUuid));
          if (conflictingLocal) {
            throw new Error(`DUPLICATE_UUID_COLLISION: local document ${conflictingLocal.id} already claims uuid ${localDocUuid}`);
          }

          const existing = await DocumentService.findByUuid(userId, localDocUuid);
          if (existing) {
            cloudId = existing.uuid || existing.id;
            await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId);
          } else {
            // LIFE-10: живой строки с этим номером нет, а ограничение
            // documents_uuid_key всё равно сработало — значит номер держит
            // НАДГРОБИЕ. Ровно этот тупик запер четырнадцать заметок в августе:
            // поиск отсеивает удалённые строки (`deleted_at is null`), а
            // ограничение — нет, и наружу выходила «duplicate key value
            // violates unique constraint».
            const buried = await withTimeout(DocumentService.getDocumentWithDeleted(userId, localDocUuid));
            if (!buried?.deletedAt) throw createErr;

            if (localDoc.unlinkedByTombstone !== true) {
              // Об удалении это устройство узнаёт впервые — возможно, её
              // сделали на другом. Обойти удаление, выгрузив заметку под новым
              // номером, значило бы отменить чужое решение молча. Записываем
              // удаление так же, как его записывает обычный проход, и говорим
              // человеку, что заметка осталась здесь.
              await LocalDocumentService.unlinkFromCloud(localDocumentId, 'tombstone');
              await dropQueueTasksFor(localDocumentId);
              useActivityLogStore.getState().addActivity(
                'Облачная копия этой заметки была удалена. Заметка осталась на устройстве; повторное «отправить в облако» создаст новую облачную копию',
                { action: 'addCloudCopy_tombstonedUuid', documentId: localDocumentId, uuid: localDocUuid },
                'warning',
                'sync',
              );
              return CLOUD_COPY_TOMBSTONE;
            }

            // Повторное нажатие после того предупреждения — осознанный ответ
            // человека: сделать новую облачную копию. Старый номер остаётся за
            // могилой навсегда (RLS 0016 делает надгробие неизменяемым), поэтому
            // копия получает новый — и это смена личности заметки, о которой
            // надо сказать вслух, а не выполнить тихо.
            const freshUuid = crypto.randomUUID();
            await LocalDocumentService.updateDocumentUuid(localDocumentId, freshUuid);
            cloudId = await withTimeout(DocumentService.createDocument(userId, {
              ...createPayload,
              uuid: freshUuid,
            }));
            await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId);
            useActivityLogStore.getState().addActivity(
              'Создана новая облачная копия: прежний номер заметки занят удалённой строкой',
              { action: 'addCloudCopy_newIdentity', documentId: localDocumentId, previousUuid: localDocUuid, uuid: freshUuid },
              'success',
              'sync',
            );
          }
        } else {
          throw createErr;
        }
      }

      try {
        const sortedVersions = [...versions].sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
        for (let i = 0; i < sortedVersions.length; i++) {
          const ver = sortedVersions[i]!;
          const prevContent = i === 0 ? '' : (sortedVersions[i - 1]?.content ?? '');
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
            mood: ver.mood,
          } satisfies VersionEncryptPayload, ['content', 'previousContent', 'mood'], [], userId);

          const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
          const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
          const mood = typeof versionPayload.mood === 'string' ? versionPayload.mood : ver.mood;
          const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;
          await withTimeout(VersionService.addVersion(userId, cloudId!, {
            content,
            previousContent,
            wordCount: ver.wordCount,
            wordsAdded: ver.wordsAdded,
            charsAdded: ver.charsAdded,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
            savedAt: ver.savedAt ? new Date(ver.savedAt) : undefined,
            mood,
            _encrypted,
          }));
        }

        await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
          totalWords: localDoc.totalWords,
          totalDuration: localDoc.totalDuration,
          currentVersion: localDoc.currentVersion,
          sessionsCount: localDoc.sessionsCount,
          lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
          mood: localDoc.mood,
        }));
      } catch (e) {
        // AUDIT-MH4: не откатываем частичную выгрузку. Облачный документ уже
        // создан, часть версий залита — удаление стирало бы успешную работу и,
        // если cleanup сам падал, оставляло orphan, который потом скачивался
        // как дубль-заметка. Ставим ссылку и бросаем дальше: retry по linked-
        // ветке докачает недостающие версии (pull/push missing там уже есть).
        if (cloudId) {
          reportError(e, { action: 'addCloudCopy_partial', cloudId }, 'warning');
          try { await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId); }
          catch { /* существующий post-hoc dedup ниже разберётся */ }
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
      try {
        const db = await getLocalDb();
        const cur = await db.get('documents', localDocumentId);
        if (cur) await db.put('documents', { ...cur, lastSyncedCloudVersion: cur.currentVersion, lastSeenCloudUpdatedAt: new Date().toISOString() });
      } catch { /* ignore */ }



      useActivityLogStore.getState().addActivity(
        'Заметка сохранена в облако',
        { action: 'addCloudCopy', documentId: localDocumentId, cloudDocumentId: cloudId },
        'success',
        'sync'
      );
      
      return cloudId;
      },
      {
        ownerId: userId,
        onLockHeld: () => '',
      },
    );
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string, localDocumentId?: string): Promise<void> {
    await DocumentService.deleteDocument(userId, cloudDocumentId);
    const { DataProvider } = await import('../data');
    try {
      await Promise.allSettled([
        DataProvider.deleteSummary(userId, cloudDocumentId),
        DataProvider.deleteEmbedding(userId, cloudDocumentId),
      ]);
    } catch { /* non-critical */ }
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
  ): Promise<{ forked: boolean; forkTitle?: string | undefined; cloudSynced: boolean; reason?: string }> {
    if (!navigator.onLine) {
      await requeueDocumentTask(documentId, userId);
      return { forked: false, cloudSynced: false };
    }

    return withDocumentLock(
      documentId,
      async () => {
        try {
      const getDoc = DocumentService.getDocumentWithDeleted?.bind(DocumentService) ?? DocumentService.getDocument.bind(DocumentService);
      const cloudDoc = await getDoc(userId, linkedCloudId);
      if (cloudDoc?._locked) {
        throw new Error('LOCKED: cannot sync version to locked cloud document');
      }
      if (cloudDoc?._decryptionError) {
        throw new Error('DECRYPTION_ERROR: cannot sync version to unreadable cloud document');
      }
      if (cloudDoc?.deletedAt) {
        // Document was soft-deleted in the cloud (tombstone). Clean up local link and syncQueue.
        await LocalStorageService.unlinkFromCloud(documentId, 'tombstone');
        await dropQueueTasksFor(documentId);
        return { forked: false, cloudSynced: false };
      }
      if (!cloudDoc) {
        await requeueDocumentTask(documentId, userId);
        return { forked: false, cloudSynced: false };
      }

      // Reconcile cloud versions before pushing (pull-before-push)
      const cloudVersions = await VersionService.getVersions(userId, linkedCloudId);
      const decryptedCloudVersions = await Promise.all(cloudVersions.map(async (cv) => {
        if (!cv._encrypted) return cv;
        try {
          const plain = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content', 'mood'], []);
          return {
            ...cv,
            content: typeof plain.content === 'string' ? plain.content : cv.content,
            mood: typeof plain.mood === 'string' ? plain.mood : cv.mood,
            _encrypted: false,
          };
        } catch (decErr) {
          if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) throw decErr;
          if (!(decErr instanceof DecryptionError)) throw decErr;
          reportError(decErr, { action: 'syncVersionToCloud_decrypt', cloudId: linkedCloudId, version: cv.version });
          return { ...cv, _decryptionError: true };
        }
      }));
      const localVersions = await LocalVersionService.getVersions(documentId);
      const cloudVerMap = new Map(decryptedCloudVersions.map(v => [v.version, v]));
      const localVerNums = new Set(localVersions.map(v => v.version));

      // Pull missing cloud versions down to local
      for (const cv of decryptedCloudVersions) {
        if (localVerNums.has(cv.version)) continue;
        if (cv._decryptionError) continue;

        await LocalVersionService.addVersion(userId, documentId, {
          content: cv.content || '',
          previousContent: '',
          wordCount: cv.wordCount,
          duration: cv.duration,
          wpm: cv.wpm,
          versionNumber: cv.version,
          sessionStartedAt: cv.sessionStartedAt ?? new Date(),
          savedAt: cv.savedAt ?? undefined,
          mood: cv.mood,
        });
      }

      const newestCloudVersion = cloudVersions.reduce((max, v) => Math.max(max, v.version ?? 0), 0);
      const maxCloudVersion = Math.max(cloudDoc.currentVersion, newestCloudVersion);

      if (maxCloudVersion >= newVersion) {
        const localDoc = await LocalStorageService.getDocument(documentId);
        const cloudHead = cloudVerMap.get(maxCloudVersion);
        const cloudHeadContent = cloudHead?.content;

        if (cloudHead) {
          // AG-CORRUPT-3: Shared predicate. An unreadable side is unknown, not different. Leave queued for retry.
          const comp = comparableOrUnknown(cloudHead, { content: data.content });
          if (!comp.comparable) {
            await requeueDocumentTask(documentId, userId);
            useActivityLogStore.getState().addActivity(
              'Синхронизация отложена: невозможно расшифровать или сравнить облачную версию',
              { action: 'syncVersionToCloud_unreadableCloudHead', documentId, version: maxCloudVersion },
              'warning',
              'sync',
            );
            return { forked: false, cloudSynced: false, reason: 'unknown' };
          }

          // 1. Idempotent write: cloud already holds this exact content at head
          if (comp.same) {
            newVersion = maxCloudVersion;
          }
          // 2. Genuine fast-forward: local edit was built directly on top of cloud head
          else if (cloudHeadContent !== undefined && prevContent === cloudHeadContent) {
            // Local started from the cloud head, but local version counter was behind:
            // advance cleanly to maxCloudVersion + 1 with NO fork
            newVersion = maxCloudVersion + 1;
          }
          // 3. Genuine divergence: cloud moved to maxCloudVersion with different content,
          // and local created divergent content from an older base
          else {
            const result = await ConflictResolver.resolveConflict(
              userId,
              documentId,
              linkedCloudId,
              data,
              newVersion,
              cloudDoc,
              localDoc?.firstSessionAt
            );
            return { ...result, cloudSynced: false };
          }
        } else {
          // AG-SYNC-11: No cloud row for maxCloudVersion. The write is not treated as idempotent.
          // Fall back to conflict resolution (divergence).
          const result = await ConflictResolver.resolveConflict(
            userId,
            documentId,
            linkedCloudId,
            data,
            newVersion,
            cloudDoc,
            localDoc?.firstSessionAt
          );
          return { ...result, cloudSynced: false };
        }
      }

      const startedAt = data.sessionStartedAt;
      if (isNaN(startedAt.getTime())) {
        throw new Error('Invalid sessionStartedAt');
      }
      const localDiff = computeWordDelta(prevContent, data.content);
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
      } satisfies VersionEncryptPayload, ['content', 'previousContent', 'mood'], [], userId);
      const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
      const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
      const mood = typeof versionPayload.mood === 'string' ? versionPayload.mood : data.mood;
      const _encrypted = typeof versionPayload._encrypted === 'boolean' ? versionPayload._encrypted : undefined;

      try {
        await VersionService.addVersion(userId, linkedCloudId, {
          content,
          previousContent,
          wordCount: data.wordCount,
          wordsAdded: localDiff.wordsAdded,
          charsAdded: localDiff.charsAdded,
          duration: data.duration,
          wpm: data.wpm,
          versionNumber: newVersion,
          goalWords: data.goalWords,
          goalTime: data.goalTime,
          goalReached: data.goalReached,
          sessionStartedAt: startedAt,
          mood,
          _encrypted,
        });
      } catch (addVerErr) {
        // Repair path for split metadata: recompute from max(version) and retry
        const freshVersions = await VersionService.getVersions(userId, linkedCloudId);
        const actualMax = freshVersions.reduce((max, v) => Math.max(max, v.version ?? 0), 0);
        if (actualMax >= newVersion) {
          newVersion = actualMax + 1;
          await VersionService.addVersion(userId, linkedCloudId, {
            content,
            previousContent,
            wordCount: data.wordCount,
            wordsAdded: localDiff.wordsAdded,
            charsAdded: localDiff.charsAdded,
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
        } else {
          throw addVerErr;
        }
      }


      await DocumentService.updateDocumentAfterSession(userId, linkedCloudId, {
        totalWords: data.documentWordCount ?? data.wordCount,
        totalDuration: data.documentDuration ?? data.duration,
        currentVersion: newVersion,
        mood: data.mood,
      });

      // N2-2 (тот же случай на пути сохранения): в заметку, которую другое
      // устройство положило в корзину, здесь только что дописали — возвращаем.
      if ((cloudDoc as { trashedAt?: unknown }).trashedAt) {
        const here = await LocalStorageService.getDocument(documentId);
        if (!here?.trashedAt) {
          await DocumentService.restoreDocument(userId, linkedCloudId);
          useActivityLogStore.getState().addActivity(
            'Заметка была в корзине на другом устройстве — после вашей правки она восстановлена',
            { action: 'syncVersionToCloud_restoredFromTrash', documentId },
            'info',
            'sync',
          );
        }
      }

      // AUDIT-MH1: успешный push фиксирует base для следующего конфликта-чекa.
      try {
        const localDoc = await LocalStorageService.getDocument(documentId);
        if (localDoc) {
          const db = await getLocalDb();
          await db.put('documents', { ...localDoc, lastSyncedCloudVersion: newVersion });
        }
      } catch { /* некритично: без поля сработает legacy-сравнение контента */ }

      useActivityLogStore.getState().addActivity(
        'Изменения сохранены в облако',
        { action: 'syncVersionToCloud', documentId, newVersion },
        'success',
        'sync'
      );
      return { forked: false, cloudSynced: true };
    } catch (e) {
      reportError(e, { action: 'syncVersionToCloud', documentId, linkedCloudId });
      if (!isPoisonSyncError(e)) {
        try {
          await requeueDocumentTask(documentId, userId);
        } catch (queueErr) {
          reportError(queueErr, { action: 'syncVersionToCloud_queueSync', documentId });
        }
      }
      return { forked: false, cloudSynced: false };
    }
  },
  {
    ownerId: userId,
    onLockHeld: () => ({ forked: false, cloudSynced: false, reason: 'LOCK_HELD' }),
  },
);
  },

  /** Pushes the locally-cached AI profile portrait to Supabase. Lives here
   *  (not in features/ai) so the sync-queue drain (core/services/SyncService,
   *  which must not import from features/) can call it directly for queued
   *  'portrait' tasks. AIProfileService.syncPortraitToCloud delegates here. */
  async syncPortraitToCloud(userId: string): Promise<void> {
    // Источник — IndexedDB, а не кэш в localStorage. Кэш привязан к аккаунту и
    // может быть пуст в момент, когда очередь синхронизации доходит до задачи:
    // именно поэтому колонка users.ai_portrait стояла пустой при живом
    // портрете на устройстве.
    const db = await getLocalDb();
    const stored = await db.get('aiPortrait', 'singleton');
    const portraitMarkdown = stored?.portrait;
    if (!portraitMarkdown) return;

    const encrypted = await maybeEncrypt(
      { aiPortrait: portraitMarkdown },
      ['aiPortrait'],
      [],
      userId,
    );
    await DataProvider.updateProfile(userId, encrypted);
  },
};

// AUDIT-part2 5.1: интерпретация флагов через единый syncStatusOf.
function isRelinkCandidate(doc: LocalDocument): boolean {
  return syncStatusOf(doc) === 'unlinked-new' && !!doc.firstSessionAt;
}

/**
 * Есть ли для заметки работа у перепривязки — вопрос, который задаётся ДО
 * чтения облака и решает, читать ли его вообще.
 *
 * Отдельно от isRelinkCandidate, потому что тот описывает только сверку по
 * времени. Сверка по постоянному номеру работает и с заметками, помеченными
 * «только на устройстве», — и без этой функции она стояла за воротами,
 * пропускавшими ровно тех, для кого была написана: проход возвращал 0, не
 * дойдя до неё.
 */
function hasRelinkWork(doc: LocalDocument): boolean {
  const status = syncStatusOf(doc);
  if (status === 'unlinked-new') return !!doc.firstSessionAt || !!doc.uuid;
  if (status === 'local-only') return !!doc.uuid;
  return false;
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
async function relinkOrphaned(localDocs: LocalDocument[], cloudDocs: Document[]): Promise<RelinkResult> {
  const takenCloudIds = new Set(localDocs.map(d => d.linkedCloudId).filter(Boolean));
  let relinkedByUuid = 0;
  const skippedIds = new Set<string>();

  // Проход первый — по ПОСТОЯННОМУ номеру заметки. Это не догадка: совпадение
  // uuid означает, что облачная строка и есть эта заметка. Сверка по времени
  // ниже появилась раньше uuid и осталась запасной.
  //
  // Сюда попадают и заметки, помеченные «только на устройстве». Это безопасно
  // по построению: удалённые в облаке строки сюда не приходят вовсе —
  // getUserDocuments отдаёт только живые, — значит совпадение возможно лишь с
  // существующей копией, а не с воскрешаемой. Без этого заметка, чья облачная
  // строка когда-то потерялась, не может вернуться в облако никогда: под своим
  // номером она не вставится (uuid уникален), а под чужим её быть не должно.
  const cloudByUuid = new Map<string, Document>();
  for (const cloudDoc of cloudDocs) {
    const uuid = (cloudDoc as { uuid?: string }).uuid;
    if (!uuid || takenCloudIds.has(cloudDoc.id)) continue;
    if (cloudByUuid.has(uuid)) { cloudByUuid.delete(uuid); continue; }  // неоднозначно — не трогаем
    cloudByUuid.set(uuid, cloudDoc);
  }
  for (const local of localDocs) {
    const status = syncStatusOf(local);
    if (status !== 'unlinked-new' && status !== 'local-only') continue;
    if (!local.uuid) continue;
    const match = cloudByUuid.get(local.uuid);
    if (!match) continue;

    // FU-3: protect against race with concurrent editor saves or other sync drains
    await withDocumentLock(
      local.id,
      async () => {
        await LocalStorageService.updateLinkedCloudId(local.id, match.id);
        local.linkedCloudId = match.id;
        delete local.localOnly;
        takenCloudIds.add(match.id);
        cloudByUuid.delete(local.uuid!);
        relinkedByUuid++;

        // Связь вернулась — но содержимое в облаке от этого не появилось: строка
        // могла остаться пустой, как и было у осиротевших. Ставим задачу в
        // очередь, иначе заметка числится связанной и не выгружается никогда.
        try {
          await requeueDocumentTask(local.id, local.guestId);
        } catch (queueErr) {
          reportError(queueErr, { action: 'relinkByUuid_queueSync', documentId: local.id });
        }
      },
      {
        queueOnHeld: false,
        onLockHeld: () => {
          // L-2: Document currently locked by active writer or sync drain.
          // Record skipped id so syncAllUnlinked does not upload a duplicate cloud note.
          skippedIds.add(local.id);
        },
      },
    );
  }

  const candidates = localDocs.filter(d => isRelinkCandidate(d) && !skippedIds.has(d.id));
  if (candidates.length === 0) return { relinked: relinkedByUuid, skippedIds: Array.from(skippedIds) };
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

  // AUDIT-L11: firstSessionAt (мс-таймстемп) — хрупкий единственный сигнал
  // идентичности. Второй сигнал — нормализованный заголовок.
  //
  // Сигнал СОВЕЩАТЕЛЬНЫЙ, а не обязательный. Заголовки облачных заметок
  // расшифровываются при чтении: при закрытом сейфе (фоновый синк ходит и
  // так) сравнивать нечего, а отказ от перелинковки означает не «оставим на
  // ручной разбор», а вторую копию в облаке — ровно тот баг, ради которого
  // перелинковка и появилась. Переименование на одном устройстве даёт то же
  // самое. Поэтому расходящимися считаем только два читаемых непустых
  // заголовка; во всех прочих случаях решает совпадение времени, как раньше.
  const norm = (t: string | undefined): string => (t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const titlesContradict = (local: LocalDocument, cloud: Document): boolean => {
    if (cloud._locked || cloud._decryptionError) return false;
    const a = norm(local.title);
    const b = norm(cloud.title);
    if (a.length === 0 || b.length === 0) return false;
    return a.slice(0, 32) !== b.slice(0, 32);
  };

  let relinked = relinkedByUuid;
  for (const [start, locals] of localsByStart) {
    const cloudMatches = cloudByStart.get(start);
    const local = locals[0];
    const cloudDoc = cloudMatches?.[0];
    if (locals.length !== 1 || cloudMatches?.length !== 1 || !local || !cloudDoc) continue;
    if (titlesContradict(local, cloudDoc)) continue;

    // FU-3: protect against race with concurrent editor saves or other sync drains
    await withDocumentLock(
      local.id,
      async () => {
        await LocalStorageService.updateLinkedCloudId(local.id, cloudDoc.id);
        local.linkedCloudId = cloudDoc.id;
        relinked++;
      },
      {
        queueOnHeld: false,
        onLockHeld: () => {
          // L-2: Document locked; record skipped id to avoid duplicate upload
          skippedIds.add(local.id);
        },
      },
    );
  }

  if (relinked > 0) {
    useActivityLogStore.getState().addActivity(
      `Заметки заново связаны с облачными копиями: ${relinked}`,
      { action: 'relinkOrphanedDocuments', relinked },
      'success',
      'sync'
    );
  }
  return { relinked, skippedIds: Array.from(skippedIds) };
}

export const __testing = { relinkOrphaned };
