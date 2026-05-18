import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb, randomUUID } from '../../../shared/lib/localDb';
import { toDate } from '../../../core/utils/dateUtils';
import { computeWordDelta } from './DiffService';

export interface StorageState {
  local: boolean;
  cloud: boolean;
}

export interface SaveDocumentData {
  title: string;
  content: string;
  wordCount: number;
  documentWordCount?: number;
  duration: number;
  wpm: number;
  tags: string[];
  labelId?: string;
  goalWords?: number;
  goalTime?: number;
  goalReached?: boolean;
  sessionStartedAt: Date;
}

const CLOUD_SYNC_TIMEOUT = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number = CLOUD_SYNC_TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Sync timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const _saveVersionLocks = new Map<string, Promise<void>>();

export const StorageService = {
  async saveNew(
    userId: string,
    data: SaveDocumentData
  ): Promise<{ localId: string }> {
    const localId = await LocalDocumentService.createDocument(userId, {
      title: data.title,
      tags: data.tags,
      labelId: data.labelId,
    });
    await LocalVersionService.addVersion(userId, localId, {
      content: data.content,
      previousContent: '',
      wordCount: data.wordCount,
      duration: data.duration,
      wpm: data.wpm,
      versionNumber: 1,
      goalWords: data.goalWords,
      goalTime: data.goalTime,
      goalReached: data.goalReached,
      sessionStartedAt: data.sessionStartedAt,
    });
    await LocalDocumentService.updateAfterSession(localId, {
      totalWords: data.documentWordCount ?? data.wordCount,
      totalDuration: data.duration,
      currentVersion: 1,
    });
    return { localId };
  },

  async saveVersion(
    userId: string,
    documentId: string,
    data: SaveDocumentData
  ): Promise<void> {
    const prevPromise = _saveVersionLocks.get(documentId) ?? Promise.resolve();
    const promise = prevPromise.then(async () => {
      const db = await getLocalDb();
      const tx = db.transaction(['documents', 'versions', 'profile'], 'readwrite');
      const docStore = tx.objectStore('documents');
      const verStore = tx.objectStore('versions');
      const profStore = tx.objectStore('profile');

      const existing = await docStore.get(documentId);
      if (!existing) { await tx.done; throw new Error('Document not found'); }

      const allVersions = await verStore.index('by-document').getAll(documentId);
      const prevContent = allVersions.length > 0
        ? allVersions.reduce((max, v) => v.version > max.version ? v : max, allVersions[0]).content ?? ''
        : '';

      const newVersion = existing.currentVersion + 1;
      const diff = computeWordDelta(prevContent, data.content);
      const verId = `ver_${randomUUID()}`;
      const totalWords = data.documentWordCount ?? data.wordCount;
      const now = Date.now();

      await verStore.put({
        id: verId,
        documentId,
        guestId: userId,
        version: newVersion,
        content: data.content,
        wordCount: data.wordCount,
        wordsAdded: diff.wordsAdded,
        charsAdded: diff.charsAdded,
        duration: data.duration,
        wpm: data.wpm,
        goalWords: data.goalWords,
        goalTime: data.goalTime,
        goalReached: data.goalReached ?? false,
        savedAt: now,
        sessionStartedAt: data.sessionStartedAt.getTime(),
      });

      await docStore.put({
        ...existing,
        totalWords,
        totalDuration: data.duration,
        currentVersion: newVersion,
        sessionsCount: (existing.sessionsCount || 0) + 1,
        lastSessionAt: now,
      });

      const profile = await profStore.get(existing.guestId);
      if (profile) {
        await profStore.put({
          ...profile,
          totalWords: profile.totalWords - existing.totalWords + totalWords,
          totalDuration: profile.totalDuration - existing.totalDuration + data.duration,
          sessionsCount: profile.sessionsCount + 1,
          lastSessionAt: now,
        });
      }

      await tx.done;

      if (!profile) {
        await LocalDocumentService._updateProfile(existing.guestId);
      }

      if (existing.linkedCloudId) {
        try {
          const cloudDoc = await DocumentService.getDocument(userId, existing.linkedCloudId);
          if (!cloudDoc) {
            const db = await getLocalDb();
            await db.put('syncQueue', {
              id: `sync_${documentId}_${Date.now()}`,
              documentId,
              type: 'document' as const,
              createdAt: Date.now(),
            });
          } else {
            const startedAt = data.sessionStartedAt;
            if (isNaN(startedAt.getTime())) {
              throw new Error('Invalid sessionStartedAt');
            }
            await VersionService.addVersion(userId, existing.linkedCloudId, {
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
            });
            await DocumentService.updateDocumentAfterSession(userId, existing.linkedCloudId, {
              totalWords: data.documentWordCount ?? data.wordCount,
              totalDuration: data.duration,
              currentVersion: newVersion,
            });
          }
        } catch (e) {
          console.error(`Cloud version sync failed for ${existing.linkedCloudId}:`, e);
          try {
            const db = await getLocalDb();
            await db.put('syncQueue', {
              id: `sync_${documentId}_${Date.now()}`,
              documentId,
              type: 'document' as const,
              createdAt: Date.now(),
            });
          } catch { /* ignore */ }
        }
      }
    });
    _saveVersionLocks.set(documentId, promise);
    try {
      await promise;
    } finally {
      if (_saveVersionLocks.get(documentId) === promise) {
        _saveVersionLocks.delete(documentId);
      }
    }
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    const allLocal = await LocalDocumentService.getGuestDocuments(userId);
    const existing = allLocal.find(d => d.linkedCloudId === cloudDocumentId);
    if (existing) return existing.id;

    const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
    if (!cloudDoc) throw new Error('Cloud document not found');

    const versions = await VersionService.getVersions(userId, cloudDocumentId);
    const firstSessionMs = toDate(cloudDoc.firstSessionAt)?.getTime() ?? undefined;
    const lastSessionMs = toDate(cloudDoc.lastSessionAt)?.getTime() ?? undefined;
    const localId = await LocalDocumentService.createDocument(userId, {
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

        await LocalVersionService.addVersion(userId, localId, {
          content: ver.content,
          previousContent: prevContent,
          wordCount: ver.wordCount,
          duration: ver.duration,
          wpm: ver.wpm,
          versionNumber: ver.version ?? 1,
          goalWords: ver.goalWords,
          goalTime: ver.goalTime,
          goalReached: ver.goalReached,
          sessionStartedAt: startedAt,
        });
        prevContent = ver.content;
      }

      await LocalDocumentService.updateDocument(localId, {
        totalWords: cloudDoc.totalWords,
        totalDuration: cloudDoc.totalDuration,
        currentVersion: cloudDoc.currentVersion,
        sessionsCount: cloudDoc.sessionsCount ?? 1,
      });

      await LocalDocumentService.updateLinkedCloudId(localId, cloudDocumentId);
    } catch (e) {
      try { await LocalDocumentService.deleteDocument(localId); } catch (err) {
        console.error('[StorageService] Failed to cleanup local doc after addLocalCopy failure:', err);
      }
      throw e;
    }

    return localId;
  },

  async addCloudCopy(userId: string, localDocumentId: string): Promise<string> {
    const db = await getLocalDb();
    const lockKey = `lock_cloud_${localDocumentId}`;

    // Atomic check+claim via IDB transaction
    const lockTx = db.transaction('syncQueue', 'readwrite');
    const existing = await lockTx.store.get(lockKey);
    if (existing) { await lockTx.done; return ''; }
    await lockTx.store.put({ id: lockKey, documentId: localDocumentId, type: 'document' as const, createdAt: Date.now() });
    await lockTx.done;

    try {
      const localDoc = await LocalDocumentService.getDocument(localDocumentId);
      if (!localDoc) throw new Error('Local document not found');

      if (localDoc.linkedCloudId) {
        const existing = await withTimeout(DocumentService.getDocument(userId, localDoc.linkedCloudId));
        if (existing) return localDoc.linkedCloudId;
        await LocalDocumentService.updateLinkedCloudId(localDocumentId, '');
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

        let prevContent = '';
        for (const ver of versions) {
          const startedAt = ver.sessionStartedAt != null
            ? new Date(ver.sessionStartedAt)
            : new Date(ver.savedAt || Date.now());
          if (isNaN(startedAt.getTime())) {
            throw new Error(`Invalid sessionStartedAt for version ${ver.id}`);
          }

          await withTimeout(VersionService.addVersion(userId, cloudId, {
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
          }));
          prevContent = ver.content;
        }

        await withTimeout(DocumentService.updateDocumentAfterSession(userId, cloudId, {
          totalWords: localDoc.totalWords,
          totalDuration: localDoc.totalDuration,
          currentVersion: localDoc.currentVersion,
        }));
      } catch (e) {
        if (cloudId) {
          try { await DocumentService.deleteDocument(userId, cloudId); } catch { /* ignore */ }
        }
        throw e;
      }

      if (!cloudId) throw new Error('Failed to create cloud document');
      await LocalDocumentService.updateLinkedCloudId(localDocumentId, cloudId);
      return cloudId;
    } finally {
      try {
        const cleanupDb = await getLocalDb();
        await cleanupDb.delete('syncQueue', lockKey);
      } catch { /* ignore */ }
    }
  },

  async removeLocalCopy(localDocumentId: string): Promise<void> {
    await LocalDocumentService.deleteDocument(localDocumentId);
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string, localDocumentId?: string): Promise<void> {
    await DocumentService.deleteDocument(userId, cloudDocumentId);
    if (localDocumentId) {
      await LocalDocumentService.updateLinkedCloudId(localDocumentId, '');
    }
  },

  async deleteDocument(
    userId: string,
    localId?: string,
    cloudId?: string
  ): Promise<void> {
    if (localId) {
      await LocalDocumentService.deleteDocument(localId);
    }
    if (cloudId) {
      try {
        await DocumentService.deleteDocument(userId, cloudId);
      } catch (e) {
        console.error(`Cloud delete failed for ${cloudId}, local copy already removed:`, e);
      }
    }
  },

  async getStorageState(
    userId: string,
    localId?: string,
    cloudId?: string
  ): Promise<StorageState> {
    const [localExists, cloudExists] = await Promise.all([
      localId ? LocalDocumentService.getDocument(localId).then(d => !!d) : Promise.resolve(false),
      cloudId ? DocumentService.getDocument(userId, cloudId).then(d => !!d) : Promise.resolve(false),
    ]);
    return { local: localExists, cloud: cloudExists };
  },
};
