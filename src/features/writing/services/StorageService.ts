import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';

export interface StorageState {
  local: boolean;
  cloud: boolean;
}

export interface SaveDocumentData {
  title: string;
  content: string;
  wordCount: number;
  duration: number;
  wpm: number;
  isPublic: boolean;
  isAnonymous: boolean;
  tags: string[];
  labelId?: string;
  goalWords?: number;
  goalTime?: number;
  goalReached?: boolean;
  sessionStartedAt: Date;
}

const _cloudSyncInProgress = new Map<string, boolean>();
const _saveVersionLocks = new Map<string, Promise<void>>();

export const StorageService = {
  async saveNew(
    userId: string,
    data: SaveDocumentData
  ): Promise<{ localId: string }> {
    const localId = await LocalDocumentService.createDocument(userId, {
      title: data.title,
      tags: data.tags,
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
      totalWords: data.wordCount,
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
    while (_saveVersionLocks.has(documentId)) {
      await _saveVersionLocks.get(documentId);
    }
    const promise = (async () => {
      const existing = await LocalDocumentService.getDocument(documentId);
      if (!existing) throw new Error('Document not found');

      const prevContent = await LocalVersionService.getLatestContent(documentId);
      const newVersion = existing.currentVersion + 1;

      await LocalVersionService.addVersion(userId, documentId, {
        content: data.content,
        previousContent: prevContent,
        wordCount: data.wordCount,
        duration: data.duration,
        wpm: data.wpm,
        versionNumber: newVersion,
        goalWords: data.goalWords,
        goalTime: data.goalTime,
        goalReached: data.goalReached,
        sessionStartedAt: data.sessionStartedAt,
      });

      await LocalDocumentService.updateAfterSession(documentId, {
        totalWords: data.wordCount,
        totalDuration: existing.totalDuration + data.duration,
        currentVersion: newVersion,
      });

      if (existing.linkedCloudId) {
        try {
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
            totalWords: data.wordCount,
            totalDuration: existing.totalDuration + data.duration,
            currentVersion: newVersion,
          });
        } catch (e) {
          console.error(`Cloud version sync failed for ${existing.linkedCloudId}:`, e);
        }
      }
    })();
    _saveVersionLocks.set(documentId, promise);
    try {
      await promise;
    } finally {
      _saveVersionLocks.delete(documentId);
    }
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
    if (!cloudDoc) throw new Error('Cloud document not found');

    const versions = await VersionService.getVersions(userId, cloudDocumentId);
    const localId = await LocalDocumentService.createDocument(userId, {
      title: cloudDoc.title,
      tags: cloudDoc.tags,
    });

    try {
      let prevContent = '';
      for (const ver of versions) {
        let startedAt: Date;
        if (typeof ver.sessionStartedAt === 'number') {
          startedAt = new Date(ver.sessionStartedAt);
        } else if (ver.sessionStartedAt && typeof ver.sessionStartedAt === 'object' && 'toDate' in (ver.sessionStartedAt as object)) {
          startedAt = (ver.sessionStartedAt as { toDate: () => Date }).toDate();
        } else if (ver.sessionStartedAt instanceof Date) {
          startedAt = ver.sessionStartedAt;
        } else if (ver.savedAt && typeof ver.savedAt === 'object' && 'toDate' in (ver.savedAt as object)) {
          startedAt = (ver.savedAt as { toDate: () => Date }).toDate();
        } else {
          startedAt = new Date();
        }
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

      await LocalDocumentService.updateAfterSession(localId, {
        totalWords: cloudDoc.totalWords,
        totalDuration: cloudDoc.totalDuration,
        currentVersion: cloudDoc.currentVersion,
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
    if (_cloudSyncInProgress.get(localDocumentId)) return '';
    _cloudSyncInProgress.set(localDocumentId, true);

    try {
      const localDoc = await LocalDocumentService.getDocument(localDocumentId);
      if (!localDoc) throw new Error('Local document not found');

      if (localDoc.linkedCloudId) {
        const existing = await DocumentService.getDocument(userId, localDoc.linkedCloudId);
        if (existing) return localDoc.linkedCloudId;
        await LocalDocumentService.updateLinkedCloudId(localDocumentId, '');
      }

      const versions = await LocalVersionService.getVersions(localDocumentId);
      let cloudId: string | null = null;

      try {
        cloudId = await DocumentService.createDocument(userId, {
          title: localDoc.title,
          isPublic: false,
          tags: localDoc.tags,
        });

        let prevContent = '';
        for (const ver of versions) {
          const startedAt = ver.sessionStartedAt
            ? new Date(ver.sessionStartedAt)
            : new Date(ver.savedAt || Date.now());
          if (isNaN(startedAt.getTime())) {
            throw new Error(`Invalid sessionStartedAt for version ${ver.id}`);
          }

          await VersionService.addVersion(userId, cloudId, {
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
          });
          prevContent = ver.content;
        }

        await DocumentService.updateDocumentAfterSession(userId, cloudId, {
          totalWords: localDoc.totalWords,
          totalDuration: localDoc.totalDuration,
          currentVersion: localDoc.currentVersion,
        });
      } catch (e) {
        if (cloudId) {
          try { await DocumentService.deleteDocument(userId, cloudId); } catch {}
        }
        throw e;
      }

      return cloudId!;
    } finally {
      _cloudSyncInProgress.delete(localDocumentId);
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
