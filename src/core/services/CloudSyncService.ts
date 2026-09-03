import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalStorageService } from './LocalStorageService';
import { syncStatusOf } from '../sync/syncStatus';
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

import pLimit from 'p-limit';
import { SaveDocumentData } from './storageTypes';
import { ConflictResolver } from './ConflictResolver';
import { useActivityLogStore } from '../../shared/activity/useActivityLogStore';
import { computeWordDelta } from './DiffService';

const CLOUD_SYNC_TIMEOUT = 30_000;
const LOCK_TTL_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number = CLOUD_SYNC_TIMEOUT): Promise<T> {
  return withTimeoutBase(promise, ms, 'Sync timeout');
}



export const CloudSyncService = {
  async restoreMissingDocuments(
    userId: string,
    opts?: { force?: boolean; onProgress?: (current: number, total: number) => void },
  ): Promise<{ restored: number; hasMore: boolean }> {
    if (getEncryptionEnabled(userId) && !getSessionKey()) {
      return { restored: 0, hasMore: false };
    }

    if (!opts?.force) {
      const lastListingTs = parseInt(localStorage.getItem('last_restore_listing_ts') || '0', 10);
      if (Date.now() - lastListingTs < 30 * 60 * 1000) {
        return { restored: 0, hasMore: false };
      }
    }
    
    // We update the timestamp only if we are actually going to list.
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

    const missingDocs = cloudDocs.filter(doc => !localCloudIds.has(doc.id));
    // Полный проход: восстанавливаем все недостающие документы за этот вызов.
    // Флаг оставлен, потому что оба вызывающих его деструктурируют
    // (useBackgroundSync, RestoreFromCloudModal); по построению он всегда
    // false. Если когда-нибудь понадобится пагинация — сначала добавить цикл
    // повторного вызова в ОБОИХ вызывающих: сейчас ни один не циклит.
    let restored = 0;
    const hasMore = false;

    for (let i = 0; i < missingDocs.length; i++) {
      const doc = missingDocs[i]!;
      opts?.onProgress?.(i + 1, missingDocs.length);
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
    if (!localDocs.some(hasRelinkWork)) return 0;
    const cloudDocs = await DocumentService.getUserDocuments(userId);
    return relinkOrphaned(localDocs, cloudDocs);
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    const allLocal = await LocalStorageService.getGuestDocuments(userId);
    const existing = allLocal.find(d => d.linkedCloudId === cloudDocumentId);
    if (existing) return existing.id;

    const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
    if (!cloudDoc) throw new Error('Cloud document not found');
    if (cloudDoc._locked) throw new Error('LOCKED: cannot add local copy of locked document');
    if (cloudDoc._decryptionError) throw new Error('DECRYPTION_ERROR: cannot add local copy of unreadable document');

    const versions = await VersionService.getVersions(userId, cloudDocumentId);
    const firstSessionMs = toDate(cloudDoc.firstSessionAt)?.getTime() ?? undefined;
    const lastSessionMs = toDate(cloudDoc.lastSessionAt)?.getTime() ?? undefined;
    const localId = await LocalStorageService.createDocument(userId, {
      title: cloudDoc.title ?? '',
      tags: cloudDoc.tags ?? [],
      labelId: cloudDoc.labelId ?? undefined,
      firstSessionAt: firstSessionMs ?? undefined,
      lastSessionAt: lastSessionMs ?? undefined,
      mood: cloudDoc.mood,
      excludedFromAI: cloudDoc.excludedFromAI,
    });

    // Accept canonical uuid from the cloud doc if present; don't overwrite a
    // local uuid when the cloud copy has none (backfill will assign one later).
    if (cloudDoc.uuid) {
      const db = await getLocalDb();
      const tx = db.transaction('documents', 'readwrite');
      const localDoc = await tx.store.get(localId);
      if (localDoc) {
        await tx.store.put({ ...localDoc, uuid: cloudDoc.uuid });
      }
      await tx.done;
    }

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
    if (!navigator.onLine) {
      throw new Error('Not connected to cloud. Changes saved locally.');
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

    // AUDIT-MH2: upload routinely живёт дольше LOCK_TTL_MS (pLimit(3) + таймауты
    // 30s) — вторая вкладка проходила «протухший» lock одновременно с первой.
    // Heartbeat продлевает createdAt, пока держатель жив.
    const lockHeartbeat = setInterval(() => {
      void (async () => {
        try {
          const hdb = await getLocalDb();
          const htx = hdb.transaction('syncQueue', 'readwrite');
          const cur = await htx.store.get(lockKey);
          if (cur) await htx.store.put({ ...cur, createdAt: Date.now() });
          await htx.done;
        } catch { /* некритично: протухший lock лучше дубля */ }
      })();
    }, LOCK_TTL_MS / 3);

    try {
      const localDoc = await LocalStorageService.getDocument(localDocumentId);
      if (!localDoc) throw new Error('Local document not found');
      if (localDoc._locked || localDoc._decryptionError) {
        throw new Error('LOCKED: cannot add cloud copy of locked document');
      }
      if (localDoc.localOnly) {
        try {
          const syncDb = await getLocalDb();
          const allTasks = await syncDb.getAll('syncQueue');
          const docTasks = allTasks.filter(t => t.documentId === localDocumentId);
          if (docTasks.length > 0) {
            const tx = syncDb.transaction('syncQueue', 'readwrite');
            for (const t of docTasks) void tx.store.delete(t.id);
            await tx.done;
          }
        } catch { /* ignore */ }
        // Кнопка, которая ничего не делает и молчит, читается как поломка.
        // Отказ здесь законный, но человек должен узнать причину.
        useActivityLogStore.getState().addActivity(
          'Заметка помечена «только на устройстве» — в облако не отправлена',
          { action: 'addCloudCopy_localOnly', documentId: localDocumentId },
          'warning',
          'sync',
        );
        return '';
      }

      if (localDoc.linkedCloudId) {
        const getDoc = DocumentService.getDocumentWithDeleted?.bind(DocumentService) ?? DocumentService.getDocument.bind(DocumentService);
        const existingDoc = await withTimeout(getDoc(userId, localDoc.linkedCloudId));
        if (existingDoc) {
          if (existingDoc.deletedAt) {
            // AUDIT-H3: заметка удалена в облаке. Unlink с флагом localOnly:
            // иначе следующий syncAllUnlinked зальёт её как НОВЫЙ облачный
            // документ и удаление «воскреснет» под другим id.
            await LocalDocumentService.unlinkFromCloud(localDocumentId);
            const syncDb = await getLocalDb();
            await syncDb.delete('syncQueue', `sync_${localDocumentId}`);
            return '';
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
              const plain = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content'], []);
              return {
                ...cv,
                content: typeof plain.content === 'string' ? plain.content : cv.content,
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
          for (const ver of localVersions) {
            const cloudVer = cloudVerMap.get(ver.version);
            if (!cloudVer) {
              // AG-SYNC-4: push if newer than newestCloud OR if filling a gap inside the active window
              if (ver.version > newestCloud || (ver.version >= oldestCloud && oldestCloud < newestCloud)) {
                missing.push(ver);
              }
            } else if (cloudVer.content !== ver.content) {
              // Same version number, but DIFFERENT content! Fork to preserve local edits
              collisions.push(ver);
            }
          }
          if (collisions.length > 0) {
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
          const limiter = pLimit(3);
          await Promise.all(missing.map((ver) => limiter(async () => {

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
              _encrypted,
            }));
          })));
          // A run that ran out of write budget left versions behind. Advancing
          // currentVersion anyway told the cloud it holds text it never received,
          // and returning the id cleared the queue — so the gap became permanent
          // and the activity log said the note was saved. Report incomplete
          // instead: the link stays (the document exists, so a retry must not
          // create a second one) and the queue keeps the work.

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

      let cloudId: string | null = null;

      try {
        cloudId = await withTimeout(DocumentService.createDocument(userId, {
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
        }));

        const limiter = pLimit(3);
        await Promise.all(versions.map((ver, i) => limiter(async () => {

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
            _encrypted,
          }));

        })));

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



      useActivityLogStore.getState().addActivity(
        'Заметка сохранена в облако',
        { action: 'addCloudCopy', documentId: localDocumentId, cloudDocumentId: cloudId },
        'success',
        'sync'
      );
      
      return cloudId;
    } finally {
      clearInterval(lockHeartbeat);
      try {
        const cleanupDb = await getLocalDb();
        await cleanupDb.delete('syncQueue', lockKey);
      } catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_lockCleanup', lockKey }); }
    }
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
  ): Promise<{ forked: boolean }> {
    if (!navigator.onLine) {
      const syncDb = await getLocalDb();
      await syncDb.put('syncQueue', {
        id: `sync_${documentId}`,
        documentId,
        type: 'document' as const,
        createdAt: Date.now(),
        ownerId: userId,
      });
      return { forked: false };
    }
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
        await LocalStorageService.unlinkFromCloud(documentId);
        const syncDb = await getLocalDb();
        await syncDb.delete('syncQueue', `sync_${documentId}`);
        return { forked: false };
      }
      if (!cloudDoc) {
        const syncDb = await getLocalDb();
        await syncDb.put('syncQueue', {
          id: `sync_${documentId}`,
          documentId,
          type: 'document' as const,
          createdAt: Date.now(),
          ownerId: userId,
        });
        return { forked: false };
      }

      // Reconcile cloud versions before pushing (pull-before-push)
      const cloudVersions = await VersionService.getVersions(userId, linkedCloudId);
      const decryptedCloudVersions = await Promise.all(cloudVersions.map(async (cv) => {
        if (!cv._encrypted) return cv;
        try {
          const plain = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content'], []);
          return {
            ...cv,
            content: typeof plain.content === 'string' ? plain.content : cv.content,
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
        // AUDIT-MH1: конфликт — расхождение с базовой версией, а не строк.
        // Если известен lastSyncedCloudVersion (версия облака, от которой
        // строилась локальная правка), divergence = base не совпал с ней.
        // Иначе — legacy-сравнение контента (старые записи без поля).
        const baseVersion = newVersion - 1;
        const hasKnownBase = localDoc?.lastSyncedCloudVersion !== undefined;
        const hasMatchingBase = hasKnownBase
          ? localDoc?.lastSyncedCloudVersion === baseVersion
          : (cloudVerMap.get(baseVersion)?.content === prevContent);
        const hasContentDivergence = !hasMatchingBase;

        if (hasContentDivergence) {
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
          // Local was just lagging behind cloud without divergence: advance version to maxCloudVersion + 1
          newVersion = maxCloudVersion + 1;
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
      } satisfies VersionEncryptPayload, ['content', 'previousContent'], [], userId);
      const content = typeof versionPayload.content === 'string' ? versionPayload.content : '';
      const previousContent = typeof versionPayload.previousContent === 'string' ? versionPayload.previousContent : '';
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
          mood: data.mood,
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
        totalDuration: data.duration,
        currentVersion: newVersion,
        mood: data.mood,
      });

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
    } catch (e) {
      reportError(e, { action: 'syncVersionToCloud', documentId, linkedCloudId });
      try {
        const syncDb = await getLocalDb();
        await syncDb.put('syncQueue', {
          id: `sync_${documentId}`,
          documentId,
          type: 'document' as const,
          createdAt: Date.now(),
          ownerId: userId,
        });
      } catch (queueErr) {
        reportError(queueErr, { action: 'syncVersionToCloud_queueSync', documentId });
      }
    }
    return { forked: false };
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
async function relinkOrphaned(localDocs: LocalDocument[], cloudDocs: Document[]): Promise<number> {
  const takenCloudIds = new Set(localDocs.map(d => d.linkedCloudId).filter(Boolean));
  let relinkedByUuid = 0;

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
    await LocalStorageService.updateLinkedCloudId(local.id, match.id);
    local.linkedCloudId = match.id;
    delete local.localOnly;
    takenCloudIds.add(match.id);
    cloudByUuid.delete(local.uuid);
    relinkedByUuid++;

    // Связь вернулась — но содержимое в облаке от этого не появилось: строка
    // могла остаться пустой, как и было у осиротевших. Ставим задачу в
    // очередь, иначе заметка числится связанной и не выгружается никогда.
    try {
      const syncDb = await getLocalDb();
      await syncDb.put('syncQueue', {
        id: `sync_${local.id}`,
        documentId: local.id,
        type: 'document' as const,
        createdAt: Date.now(),
        ownerId: local.guestId,
      });
    } catch (queueErr) {
      reportError(queueErr, { action: 'relinkByUuid_queueSync', documentId: local.id });
    }
  }

  const candidates = localDocs.filter(isRelinkCandidate);
  if (candidates.length === 0) return relinkedByUuid;
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

export const __testing = { relinkOrphaned };
