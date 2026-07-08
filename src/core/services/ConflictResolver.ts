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
    cloudDoc: { currentVersion: number },
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
    reportError(new Error('Sync conflict: document forked'), { action: 'syncVersionToCloud_conflict', documentId, linkedCloudId, cloudVersion: cloudDoc.currentVersion, localVersion: newVersion }, 'warning');
    const syncDb = await getLocalDb();
    await syncDb.put('syncQueue', {
      id: `sync_${forkedDocId}_${Date.now()}`,
      documentId: forkedDocId,
      type: 'document' as const,
      createdAt: Date.now(),
    });
    return { forked: true };
  },
};
