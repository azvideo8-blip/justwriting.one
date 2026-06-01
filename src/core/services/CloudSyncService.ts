import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalStorageService } from './LocalStorageService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb } from '../storage/localDb';
import { toDate } from '../utils/dateUtils';
import { maybeEncrypt, maybeDecrypt, type VersionEncryptPayload } from '../crypto/cryptoHelpers';
import { reportError } from '../errors/reportError';
import { isFirestoreConnected } from '../firebase/firestore';
import pLimit from 'p-limit';
import { SaveDocumentData } from './storageTypes';
import { ConflictResolver } from './ConflictResolver';

const CLOUD_SYNC_TIMEOUT = 30_000;
const LOCK_TTL_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number = CLOUD_SYNC_TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Sync timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export const CloudSyncService = {
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
      for (const ver of versions) {
        let startedAt = toDate(ver.sessionStartedAt) ?? toDate(ver.savedAt) ?? new Date();
        if (isNaN(startedAt.getTime())) startedAt = new Date();

        const decryptedVer = await maybeDecrypt(ver as unknown as Record<string, unknown>, ['content'], []);
        const verContent = (decryptedVer.content as string) ?? ver.content;

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

      await LocalStorageService.updateDocument(localId, {
        totalWords: cloudDoc.totalWords,
        totalDuration: cloudDoc.totalDuration,
        currentVersion: cloudDoc.currentVersion,
        sessionsCount: cloudDoc.sessionsCount ?? 1,
      });

      await LocalStorageService.updateLinkedCloudId(localId, cloudDocumentId);
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
        if (existingDoc) return localDoc.linkedCloudId;
        await LocalStorageService.updateLinkedCloudId(localDocumentId, '');
      }

      const versions = await LocalVersionService.getVersions(localDocumentId);
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
          const prevContent = i === 0 ? '' : versions[i - 1].content;
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

          await withTimeout(VersionService.addVersion(userId, cloudId!, {
            content: versionPayload.content as string,
            previousContent: versionPayload.previousContent as string,
            wordCount: ver.wordCount,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            goalWords: ver.goalWords,
            goalTime: ver.goalTime,
            goalReached: ver.goalReached,
            sessionStartedAt: startedAt,
            savedAt: ver.savedAt ? new Date(ver.savedAt) : undefined,
            _encrypted: versionPayload._encrypted as boolean | undefined,
          }));
        })));

        await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
          totalWords: localDoc.totalWords,
          totalDuration: localDoc.totalDuration,
          currentVersion: localDoc.currentVersion,
          sessionsCount: localDoc.sessionsCount,
          lastSessionAt: localDoc.lastSessionAt ? new Date(localDoc.lastSessionAt) : undefined,
        }));
      } catch (e) {
        if (cloudId) {
          try { await DocumentService.deleteDocument(userId, cloudId); } catch (cleanupErr) { reportError(cleanupErr, { action: 'addCloudCopy_cleanup', cloudId }); }
        }
        throw e;
      }

      if (!cloudId) throw new Error('Failed to create cloud document');
      await LocalStorageService.updateLinkedCloudId(localDocumentId, cloudId);
      await LocalStorageService.migrateDocumentOwner(localDocumentId, userId);
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
        id: `sync_${documentId}_${Date.now()}`,
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
          id: `sync_${documentId}_${Date.now()}`,
          documentId,
          type: 'document' as const,
          createdAt: Date.now(),
        });
      } else if (cloudDoc.currentVersion >= newVersion) {
        const result = await ConflictResolver.resolveConflict(userId, documentId, linkedCloudId, data, newVersion, cloudDoc);
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
        await VersionService.addVersion(userId, linkedCloudId, {
          content: versionPayload.content as string,
          previousContent: versionPayload.previousContent as string,
          wordCount: data.wordCount,
          duration: data.duration,
          wpm: data.wpm,
          versionNumber: newVersion,
          goalWords: data.goalWords,
          goalTime: data.goalTime,
          goalReached: data.goalReached,
          sessionStartedAt: startedAt,
          mood: data.mood,
          _encrypted: versionPayload._encrypted as boolean | undefined,
        });
        await DocumentService.updateDocumentAfterSession(userId, linkedCloudId, {
          totalWords: data.documentWordCount ?? data.wordCount,
          totalDuration: data.duration,
          currentVersion: newVersion,
          mood: data.mood,
        });
      }
    } catch (e) {
      reportError(e, { action: 'syncVersionToCloud', documentId, linkedCloudId });
      try {
        const syncDb = await getLocalDb();
        await syncDb.put('syncQueue', {
          id: `sync_${documentId}_${Date.now()}`,
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
};
