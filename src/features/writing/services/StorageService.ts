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
  tags: string[];
  labelId?: string;
  goalWords?: number;
  goalTime?: number;
  goalReached?: boolean;
  sessionStartedAt: Date;
}

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
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
    if (!cloudDoc) throw new Error('Cloud document not found');

    const versions = await VersionService.getVersions(userId, cloudDocumentId);
    const localId = await LocalDocumentService.createDocument(userId, {
      title: cloudDoc.title,
      tags: cloudDoc.tags,
    });

    for (const ver of versions) {
      const startedAt = (ver.sessionStartedAt as { toDate?: () => Date })?.toDate?.()
        ?? (ver.sessionStartedAt instanceof Date ? ver.sessionStartedAt : null)
        ?? new Date(ver.savedAt?.toDate?.() ?? Date.now());

      await LocalVersionService.addVersion(userId, localId, {
        content: ver.content,
        previousContent: '',
        wordCount: ver.wordCount,
        duration: ver.duration,
        wpm: ver.wpm,
        versionNumber: ver.version,
        goalWords: ver.goalWords,
        goalTime: ver.goalTime,
        goalReached: ver.goalReached,
        sessionStartedAt: startedAt,
      });
    }

    await LocalDocumentService.updateAfterSession(localId, {
      totalWords: cloudDoc.totalWords,
      totalDuration: cloudDoc.totalDuration,
      currentVersion: cloudDoc.currentVersion,
    });

    await LocalDocumentService.updateLinkedCloudId(localId, cloudDocumentId);

    return localId;
  },

  async addCloudCopy(userId: string, localDocumentId: string): Promise<string> {
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
  },

  async removeLocalCopy(localDocumentId: string): Promise<void> {
    await LocalDocumentService.deleteDocument(localDocumentId);
  },

  async removeCloudCopy(userId: string, cloudDocumentId: string): Promise<void> {
    await DocumentService.deleteDocument(userId, cloudDocumentId);
  },

  async deleteDocument(
    userId: string,
    localId?: string,
    cloudId?: string
  ): Promise<void> {
    await Promise.all([
      localId ? LocalDocumentService.deleteDocument(localId) : Promise.resolve(),
      cloudId ? DocumentService.deleteDocument(userId, cloudId) : Promise.resolve(),
    ]);
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
