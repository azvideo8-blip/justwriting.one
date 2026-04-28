import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { SessionSource } from '../hooks/useSessionSource';
import { getOrCreateGuestId } from '../../../shared/lib/localDb';

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
    data: SaveDocumentData,
    preference: SessionSource
  ): Promise<{ localId?: string; cloudId?: string }> {
    const result: { localId?: string; cloudId?: string } = {};

    if (preference === 'local' || preference === 'both') {
      const localGuestId = getOrCreateGuestId();
      const localId = await LocalDocumentService.createDocument(localGuestId, {
        title: data.title,
        tags: data.tags,
      });
      await LocalVersionService.addVersion(localGuestId, localId, {
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
      result.localId = localId;
    }

    if (preference === 'cloud' || preference === 'both') {
      const cloudId = await DocumentService.createDocument(userId, {
        title: data.title,
        isPublic: data.isPublic,
        tags: data.tags,
        labelId: data.labelId,
      });
      await VersionService.addVersion(userId, cloudId, {
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
      await DocumentService.updateDocumentAfterSession(userId, cloudId, {
        totalWords: data.wordCount,
        totalDuration: data.duration,
        currentVersion: 1,
      });
      result.cloudId = cloudId;
    }

    return result;
  },

  async saveVersion(
    userId: string,
    documentId: string,
    data: SaveDocumentData,
    preference: SessionSource,
    isLocal: boolean
  ): Promise<void> {
    if ((preference === 'local' || preference === 'both') && isLocal) {
      const localGuestId = getOrCreateGuestId();
      const existing = await LocalDocumentService.getDocument(documentId);
      if (existing) {
        const prevContent = await LocalVersionService.getLatestContent(documentId);
        const newVersion = existing.currentVersion + 1;
        await LocalVersionService.addVersion(localGuestId, documentId, {
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
      }
    }

    if ((preference === 'cloud' || preference === 'both') && !isLocal) {
      const existing = await DocumentService.getDocument(userId, documentId);
      if (existing) {
        const versions = await VersionService.getVersions(userId, documentId);
        const prevContent = versions[versions.length - 1]?.content ?? '';
        const newVersion = existing.currentVersion + 1;
        await VersionService.addVersion(userId, documentId, {
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
        await DocumentService.updateDocumentAfterSession(userId, documentId, {
          totalWords: data.wordCount,
          totalDuration: existing.totalDuration + data.duration,
          currentVersion: newVersion,
        });
      }
    }
  },

  async addLocalCopy(userId: string, cloudDocumentId: string): Promise<string> {
    const cloudDoc = await DocumentService.getDocument(userId, cloudDocumentId);
    if (!cloudDoc) throw new Error('Cloud document not found');

    const versions = await VersionService.getVersions(userId, cloudDocumentId);
    const localGuestId = getOrCreateGuestId();
    const localId = await LocalDocumentService.createDocument(localGuestId, {
      title: cloudDoc.title,
      tags: cloudDoc.tags,
    });

    for (const ver of versions) {
      await LocalVersionService.addVersion(localGuestId, localId, {
        content: ver.content,
        previousContent: '',
        wordCount: ver.wordCount,
        duration: ver.duration,
        wpm: ver.wpm,
        versionNumber: ver.version,
        sessionStartedAt: (ver.sessionStartedAt as { toDate?: () => Date }).toDate?.() ?? new Date(ver.sessionStartedAt as unknown as number),
      });
    }

    await LocalDocumentService.updateAfterSession(localId, {
      totalWords: cloudDoc.totalWords,
      totalDuration: cloudDoc.totalDuration,
      currentVersion: cloudDoc.currentVersion,
    });

    return localId;
  },

  async addCloudCopy(userId: string, localDocumentId: string): Promise<string> {
    const localDoc = await LocalDocumentService.getDocument(localDocumentId);
    if (!localDoc) throw new Error('Local document not found');

    const versions = await LocalVersionService.getVersions(localDocumentId);
    const cloudId = await DocumentService.createDocument(userId, {
      title: localDoc.title,
      isPublic: false,
      tags: localDoc.tags,
    });

    for (const ver of versions) {
      await VersionService.addVersion(userId, cloudId, {
        content: ver.content,
        previousContent: '',
        wordCount: ver.wordCount,
        duration: ver.duration,
        wpm: ver.wpm,
        versionNumber: ver.version,
        sessionStartedAt: new Date(ver.sessionStartedAt),
      });
    }

    await DocumentService.updateDocumentAfterSession(userId, cloudId, {
      totalWords: localDoc.totalWords,
      totalDuration: localDoc.totalDuration,
      currentVersion: localDoc.currentVersion,
    });

    return cloudId;
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
