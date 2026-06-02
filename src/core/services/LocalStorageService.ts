import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb, randomUUID, LocalDocument } from '../storage/localDb';
import { computeWordDelta } from './DiffService';
import { reportError } from '../../core/errors/reportError';
import { SaveDocumentData } from './storageTypes';

export const LocalStorageService = {
  async saveNew(userId: string, data: SaveDocumentData): Promise<{ localId: string }> {
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
      mood: data.mood,
    });
    await LocalDocumentService.updateAfterSession(localId, {
      totalWords: data.documentWordCount ?? data.wordCount,
      totalDuration: data.duration,
      currentVersion: 1,
      mood: data.mood,
    });
    return { localId };
  },

  async saveVersionToLocal(
    db: Awaited<ReturnType<typeof getLocalDb>>,
    documentId: string,
    data: SaveDocumentData,
    existing: LocalDocument,
    newVersion: number,
    prevContent: string,
    now: number
  ): Promise<boolean> {
    const tx = db.transaction(['documents', 'versions'], 'readwrite');
    const docStore = tx.objectStore('documents');
    const verStore = tx.objectStore('versions');

    const diff = computeWordDelta(prevContent, data.content);
    const verId = `ver_${randomUUID()}`;
    const totalWords = data.documentWordCount ?? data.wordCount;

    try {
      await verStore.put({
        id: verId,
        documentId,
        guestId: existing.guestId,
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
        mood: data.mood,
      });

      await docStore.put({
        ...existing,
        totalWords,
        totalDuration: data.duration,
        currentVersion: newVersion,
        sessionsCount: (existing.sessionsCount || 0) + 1,
        lastSessionAt: now,
        mood: data.mood,
      });

      await tx.done;
    } catch (localErr) {
      if (localErr instanceof DOMException && localErr.name === 'QuotaExceededError') {
        reportError(localErr, { action: 'saveVersionToLocal', documentId, quotaExceeded: true }, 'warning');
        return false;
      } else {
        reportError(localErr, { action: 'saveVersionToLocal_localSave', documentId });
        throw localErr;
      }
    }
    return true;
  },

  async getDocument(localId: string) {
    return LocalDocumentService.getDocument(localId);
  },

  async getVersions(localId: string) {
    return LocalVersionService.getVersions(localId);
  },

  async deleteDocument(localId: string): Promise<void> {
    await LocalDocumentService.deleteDocument(localId);
  },

  async createDocument(userId: string, data: Parameters<typeof LocalDocumentService.createDocument>[1]) {
    return LocalDocumentService.createDocument(userId, data);
  },

  async updateDocument(localId: string, data: Parameters<typeof LocalDocumentService.updateDocument>[1]) {
    await LocalDocumentService.updateDocument(localId, data);
  },

  async updateAfterSession(localId: string, data: Parameters<typeof LocalDocumentService.updateAfterSession>[1]) {
    await LocalDocumentService.updateAfterSession(localId, data);
  },

  async updateLinkedCloudId(localId: string, cloudId: string) {
    await LocalDocumentService.updateLinkedCloudId(localId, cloudId);
  },

  async migrateDocumentOwner(localId: string, userId: string) {
    await LocalDocumentService.migrateDocumentOwner(localId, userId);
  },

  async getGuestDocuments(userId: string) {
    return LocalDocumentService.getGuestDocuments(userId);
  },
};
