import { getLocalDb, LocalVersion, randomUUID } from '../storage/localDb';
import { computeWordDelta } from './DiffService';
import { DataProvider } from '../data';
import { reportError } from '../../shared/errors/reportError';

export const LocalVersionService = {
  async addVersion(
    guestId: string,
    documentId: string,
    data: {
      content: string;
      previousContent: string;
      wordCount: number;
      duration: number;
      wpm: number;
      versionNumber: number;
      goalWords?: number | undefined;
      goalTime?: number | undefined;
      goalReached?: boolean | undefined;
      sessionStartedAt: Date;
      savedAt?: Date | undefined;
      mood?: string | undefined;
    }
  ): Promise<string> {
    const db = await getLocalDb();
    const id = `ver_${randomUUID()}`;
    const diff = computeWordDelta(data.previousContent, data.content);

    await db.put('versions', {
      id,
      documentId,
      guestId,
      version: data.versionNumber,
      content: data.content,
      wordCount: data.wordCount,
      wordsAdded: diff.wordsAdded,
      charsAdded: diff.charsAdded,
      duration: data.duration,
      wpm: data.wpm,
      goalWords: data.goalWords,
      goalTime: data.goalTime,
      goalReached: data.goalReached ?? false,
      savedAt: data.savedAt ? data.savedAt.getTime() : Date.now(),
      sessionStartedAt: data.sessionStartedAt.getTime(),
      mood: data.mood,
    });

    return id;
  },

  async getVersions(documentId: string): Promise<LocalVersion[]> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('versions', 'by-document', documentId);
    return all.sort((a, b) => a.version - b.version);
  },

  // REG-4a: Count versions that will be removed across the given documents (all versions except latest for each doc with >1 versions)
  async countCollapsibleVersions(documentIds: string[]): Promise<number> {
    const db = await getLocalDb();
    const counts = await Promise.all(documentIds.map(id => db.countFromIndex('versions', 'by-document', id)));
    return counts.reduce((acc, c) => acc + (c > 1 ? c - 1 : 0), 0);
  },

  // DEEP-6 / REG-4a: Keep only the latest version row for a document, deleting older ones
  // locally AND in the cloud (if linkedCloudId exists and userId is provided).
  // Cloud deletion errors are reported and returned so callers can inform the user.
  async collapseToLatest(documentId: string, userId?: string): Promise<{ removedCount: number; deletedVersionNumbers: number[]; cloudError?: unknown }> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('versions', 'by-document', documentId);
    if (all.length <= 1) return { removedCount: 0, deletedVersionNumbers: [] };
    all.sort((a, b) => a.version - b.version);
    const keep = all[all.length - 1];
    const tx = db.transaction('versions', 'readwrite');
    const toDelete = all.filter(v => keep && v.id !== keep.id);
    const deletedVersionNumbers = toDelete.map(v => v.version);
    await Promise.all(toDelete.map(v => tx.store.delete(v.id)));
    await tx.done;

    let cloudError: unknown | undefined;
    if (userId && deletedVersionNumbers.length > 0) {
      try {
        const doc = await db.get('documents', documentId);
        if (doc?.linkedCloudId) {
          await DataProvider.deleteVersionsBatch(userId, doc.linkedCloudId, deletedVersionNumbers.map(String));
        }
      } catch (cloudErr) {
        reportError(cloudErr, { action: 'collapseToLatest_cloud', documentId });
        cloudError = cloudErr;
      }
    }

    return { removedCount: toDelete.length, deletedVersionNumbers, ...(cloudError ? { cloudError } : {}) };
  },

  async getLatestContent(documentId: string): Promise<string> {
    const db = await getLocalDb();
    const tx = db.transaction('versions', 'readonly');
    const index = tx.store.index('by-doc-version');
    const range = IDBKeyRange.bound([documentId, 0], [documentId, Number.MAX_SAFE_INTEGER]);
    const cursor = await index.openCursor(range, 'prev');
    return cursor?.value.content ?? '';
  },

  async getLatestPreview(documentId: string, maxLength = 100, customUid?: string): Promise<string> {
    const db = await getLocalDb(customUid);
    const tx = db.transaction('versions', 'readonly');
    const index = tx.store.index('by-doc-version');
    const range = IDBKeyRange.bound([documentId, 0], [documentId, Number.MAX_SAFE_INTEGER]);
    const cursor = await index.openCursor(range, 'prev');
    const content = cursor?.value?.content;
    return typeof content === 'string' ? content.slice(0, maxLength) : '';
  },

  /** Последняя версия целиком — для дневной дельты слов (#101): heatmap и
   *  стрик красят день словами сессии, а не объёмом всей заметки. */
  async getLatestVersionMeta(documentId: string, customUid?: string): Promise<{ wordsAdded: number } | null> {
    const db = await getLocalDb(customUid);
    const tx = db.transaction('versions', 'readonly');
    const index = tx.store.index('by-doc-version');
    const range = IDBKeyRange.bound([documentId, 0], [documentId, Number.MAX_SAFE_INTEGER]);
    const cursor = await index.openCursor(range, 'prev');
    if (!cursor?.value) return null;
    return { wordsAdded: typeof cursor.value.wordsAdded === 'number' ? cursor.value.wordsAdded : 0 };
  },

  /** DEEP-2: Метаданные всех версий (подходов) к документу для статистики
   *  (heatmap, стрик, часы активности) без вычитывания текстового content. */
  async getDocumentSittings(documentId: string, customUid?: string): Promise<import('../../types').SessionSitting[]> {
    const db = await getLocalDb(customUid);
    const tx = db.transaction('versions', 'readonly');
    const index = tx.store.index('by-doc-version');
    const range = IDBKeyRange.bound([documentId, 0], [documentId, Number.MAX_SAFE_INTEGER]);
    let cursor = await index.openCursor(range);
    const sittings: import('../../types').SessionSitting[] = [];
    while (cursor) {
      const v = cursor.value;
      sittings.push({
        id: v.id,
        documentId: v.documentId,
        version: v.version,
        sessionStartedAt: v.sessionStartedAt,
        savedAt: v.savedAt,
        wordsAdded: typeof v.wordsAdded === 'number' ? v.wordsAdded : 0,
        duration: typeof v.duration === 'number' ? v.duration : 0,
      });
      cursor = await cursor.continue();
    }
    return sittings;
  },
};
