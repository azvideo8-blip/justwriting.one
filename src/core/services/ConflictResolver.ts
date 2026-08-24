import { LocalStorageService } from './LocalStorageService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb } from '../storage/localDb';
import { reportError } from '../../shared/errors/reportError';
import { SaveDocumentData } from './storageTypes';

export const ConflictResolver = {
  async resolveConflict(
    userId: string,
    documentId: string,
    linkedCloudId: string,
    data: SaveDocumentData,
    newVersion: number,
    cloudDoc: { currentVersion: number; totalWords?: number; totalDuration?: number },
    originalFirstSessionAt?: number
  ): Promise<{ forked: boolean }> {
    const conflictTitle = `${data.title || 'Untitled'} (Conflict ${new Date().toLocaleDateString()})`;
    const forkedDocId = await LocalStorageService.createDocument(userId, {
      title: conflictTitle,
      tags: data.tags,
      labelId: data.labelId,
      firstSessionAt: originalFirstSessionAt ?? data.sessionStartedAt.getTime(),
      lastSessionAt: Date.now(),
    });
    await LocalVersionService.addVersion(userId, forkedDocId, {
      content: data.content,
      previousContent: '',
      wordCount: data.wordCount,
      duration: data.duration,
      wpm: data.wpm,
      versionNumber: 1,
      sessionStartedAt: data.sessionStartedAt,
      mood: data.mood,
    });
    await LocalStorageService.updateAfterSession(forkedDocId, {
      totalWords: data.wordCount,
      totalDuration: data.duration,
      currentVersion: 1,
      mood: data.mood,
    });

    // Bring the ORIGINAL local document in line with the cloud so it doesn't stay stuck in conflict
    try {
      const { VersionService } = await import('./VersionService');
      const cloudVersions = await VersionService.getVersions(userId, linkedCloudId);
      const localVersions = await LocalVersionService.getVersions(documentId);
      const localVerNums = new Set(localVersions.map(v => v.version));

      for (const cv of cloudVersions) {
        if (localVerNums.has(cv.version)) continue;

        // Тот же инвариант, что в addCloudCopy: локальный стор хранит
        // открытый текст, шифротекст в него не пишется.
        const { maybeDecrypt, DecryptionError } = await import('../crypto/cryptoHelpers');
        let plain: Record<string, unknown>;
        try {
          plain = await maybeDecrypt(cv as unknown as Record<string, unknown>, ['content'], []);
        } catch (decErr) {
          if (!(decErr instanceof DecryptionError)) throw decErr;
          reportError(decErr, { action: 'resolveConflict_decrypt', linkedCloudId, version: cv.version });
          continue;
        }

        await LocalVersionService.addVersion(userId, documentId, {
          content: typeof plain.content === 'string' ? plain.content : '',
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
      const maxCloudVersion = Math.max(cloudDoc.currentVersion, ...cloudVersions.map(v => v.version), 0);
      await LocalStorageService.updateAfterSession(documentId, {
        totalWords: cloudDoc.totalWords ?? data.wordCount,
        totalDuration: cloudDoc.totalDuration ?? data.duration,
        currentVersion: maxCloudVersion,
      });
    } catch (reconcileErr) {
      reportError(reconcileErr, { action: 'resolveConflict_reconcileOriginal', documentId, linkedCloudId });
    }

    reportError(new Error('Sync conflict: document forked'), { action: 'syncVersionToCloud_conflict', documentId, linkedCloudId, cloudVersion: cloudDoc.currentVersion, localVersion: newVersion }, 'warning');
    const syncDb = await getLocalDb();
    await syncDb.put('syncQueue', {
      id: `sync_${forkedDocId}_${Date.now()}`,
      documentId: forkedDocId,
      type: 'document' as const,
      createdAt: Date.now(),
      ownerId: userId,
    });
    return { forked: true };
  },
};
