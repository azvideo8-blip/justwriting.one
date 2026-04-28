import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { DocumentService } from './DocumentService';
import { VersionService } from './VersionService';
import { getLocalDb, getOrCreateGuestId } from '../../../shared/lib/localDb';

export interface MigrationResult {
  total: number;
  migrated: number;
  failed: number;
}

export const MigrationService = {
  async hasLocalDocuments(guestId: string): Promise<boolean> {
    const docs = await LocalDocumentService.getGuestDocuments(guestId);
    return docs.length > 0;
  },

  async getLocalDocumentCount(guestId: string): Promise<number> {
    const docs = await LocalDocumentService.getGuestDocuments(guestId);
    return docs.length;
  },

  async migrateAllToCloud(
    guestId: string,
    userId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<MigrationResult> {
    const localDocs = await LocalDocumentService.getGuestDocuments(guestId);
    const result: MigrationResult = {
      total: localDocs.length,
      migrated: 0,
      failed: 0,
    };

    for (let i = 0; i < localDocs.length; i++) {
      const localDoc = localDocs[i];
      onProgress?.(i + 1, localDocs.length);

      try {
        const cloudDocId = await DocumentService.createDocument(userId, {
          title: localDoc.title,
          isPublic: false,
          tags: localDoc.tags,
        });

        const versions = await LocalVersionService.getVersions(localDoc.id);

        for (const version of versions) {
          const prevVersion = versions[version.version - 2];
          await VersionService.addVersion(userId, cloudDocId, {
            content: version.content,
            previousContent: prevVersion?.content ?? '',
            wordCount: version.wordCount,
            duration: version.duration,
            wpm: version.wpm,
            versionNumber: version.version,
            goalWords: version.goalWords,
            goalTime: version.goalTime,
            goalReached: version.goalReached,
            sessionStartedAt: new Date(version.sessionStartedAt),
          });
        }

        await DocumentService.updateDocumentAfterSession(userId, cloudDocId, {
          totalWords: localDoc.totalWords,
          totalDuration: localDoc.totalDuration,
          currentVersion: localDoc.currentVersion,
        });

        const db = await getLocalDb();
        await db.put('syncQueue', {
          id: `migrated_${localDoc.id}`,
          documentId: localDoc.id,
          type: 'document' as const,
          createdAt: Date.now(),
        });

        result.migrated++;
      } catch (e) {
        console.error(`Failed to migrate document ${localDoc.id}:`, e);
        result.failed++;
      }
    }

    return result;
  },

  async clearLocalData(guestId: string): Promise<void> {
    const docs = await LocalDocumentService.getGuestDocuments(guestId);
    for (const doc of docs) {
      await LocalDocumentService.deleteDocument(doc.id);
    }
  },

  async migrateToLocal(
    userId: string,
    documentIds: string[]
  ): Promise<MigrationResult> {
    const result: MigrationResult = { total: documentIds.length, migrated: 0, failed: 0 };
    const localGuestId = getOrCreateGuestId();

    for (const docId of documentIds) {
      try {
        const cloudDoc = await DocumentService.getDocument(userId, docId);
        if (!cloudDoc) { result.failed++; continue; }

        const localId = await LocalDocumentService.createDocument(localGuestId, {
          title: cloudDoc.title,
          tags: cloudDoc.tags,
        });

        const versions = await VersionService.getVersions(userId, docId);
        for (const ver of versions) {
          await LocalVersionService.addVersion(localGuestId, localId, {
            content: ver.content,
            previousContent: '',
            wordCount: ver.wordCount,
            duration: ver.duration,
            wpm: ver.wpm,
            versionNumber: ver.version,
            sessionStartedAt: (ver.sessionStartedAt as { toDate?: () => Date }).toDate?.() ?? new Date(),
          });
        }

        await LocalDocumentService.updateAfterSession(localId, {
          totalWords: cloudDoc.totalWords,
          totalDuration: cloudDoc.totalDuration,
          currentVersion: cloudDoc.currentVersion,
        });

        result.migrated++;
      } catch (e) {
        console.error(`Failed to download doc ${docId}:`, e);
        result.failed++;
      }
    }

    return result;
  },

  async downloadAllToLocal(userId: string): Promise<MigrationResult> {
    const cloudDocs = await DocumentService.getUserDocuments(userId);
    return MigrationService.migrateToLocal(userId, cloudDocs.map(d => d.id));
  },

  async migrateToCloud(
    userId: string,
    documentIds: string[]
  ): Promise<MigrationResult> {
    const result: MigrationResult = { total: documentIds.length, migrated: 0, failed: 0 };

    for (const docId of documentIds) {
      try {
        const localDoc = await LocalDocumentService.getDocument(docId);
        if (!localDoc) { result.failed++; continue; }

        const cloudDocId = await DocumentService.createDocument(userId, {
          title: localDoc.title,
          isPublic: false,
          tags: localDoc.tags,
        });

        const versions = await LocalVersionService.getVersions(localDoc.id);
        for (const version of versions) {
          const prevVersion = versions[version.version - 2];
          await VersionService.addVersion(userId, cloudDocId, {
            content: version.content,
            previousContent: prevVersion?.content ?? '',
            wordCount: version.wordCount,
            duration: version.duration,
            wpm: version.wpm,
            versionNumber: version.version,
            goalWords: version.goalWords,
            goalTime: version.goalTime,
            goalReached: version.goalReached,
            sessionStartedAt: new Date(version.sessionStartedAt),
          });
        }

        await DocumentService.updateDocumentAfterSession(userId, cloudDocId, {
          totalWords: localDoc.totalWords,
          totalDuration: localDoc.totalDuration,
          currentVersion: localDoc.currentVersion,
        });

        result.migrated++;
      } catch (e) {
        console.error(`Failed to upload doc ${docId}:`, e);
        result.failed++;
      }
    }

    return result;
  },
};
