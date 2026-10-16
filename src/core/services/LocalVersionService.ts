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
    const db = await getLocalDb(guestId);
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

  async getVersions(documentId: string, ownerId?: string): Promise<LocalVersion[]> {
    const db = await getLocalDb(ownerId);
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
    const db = await getLocalDb(userId);
    const all = await db.getAllFromIndex('versions', 'by-document', documentId);
    if (all.length <= 1) return { removedCount: 0, deletedVersionNumbers: [] };
    all.sort((a, b) => a.version - b.version);
    const keep = all[all.length - 1];
    const toDelete = all.filter(v => keep && v.id !== keep.id);
    const deletedVersionNumbers = toDelete.map(v => v.version);

    // EA-13: сначала облако, потом устройство. В обратном порядке сбой облака
    // оставлял там старые версии, и следующая загрузка скачивала их обратно.
    if (userId) {
      try {
        const doc = await db.get('documents', documentId);
        if (doc?.linkedCloudId) {
          await DataProvider.deleteVersionsBatch(userId, doc.linkedCloudId, deletedVersionNumbers.map(String));
        }
      } catch (cloudErr) {
        reportError(cloudErr, { action: 'collapseToLatest_cloud', documentId });
        return { removedCount: 0, deletedVersionNumbers: [], cloudError: cloudErr };
      }
    }

    const tx = db.transaction('versions', 'readwrite');
    await Promise.all(toDelete.map(v => tx.store.delete(v.id)));
    await tx.done;
    return { removedCount: toDelete.length, deletedVersionNumbers };
  },

  async getLatestContent(documentId: string, ownerId?: string): Promise<string> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('versions', 'readonly');
    const index = tx.store.index('by-doc-version');
    const range = IDBKeyRange.bound([documentId, 0], [documentId, Number.MAX_SAFE_INTEGER]);
    const cursor = await index.openCursor(range, 'prev');
    return cursor?.value.content ?? '';
  },

  /**
   * R7Q-002: пустая строка из `getLatestContent` значит и «версий нет» (текст
   * ещё не приехал), и «заметку очистили». Страховка обязана различать эти
   * случаи, иначе заметку с нулевым текстом нельзя открыть вовсе.
   */
  async hasVersion(documentId: string, ownerId?: string): Promise<boolean> {
    const db = await getLocalDb(ownerId);
    const tx = db.transaction('versions', 'readonly');
    const range = IDBKeyRange.bound([documentId, 0], [documentId, Number.MAX_SAFE_INTEGER]);
    return (await tx.store.index('by-doc-version').count(range)) > 0;
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

  /**
   * E-7: Батч-чтение метаданных версий для всех документов за один проход cursor.
   * Устраняет N+1 транзакций при загрузке архива/списка сессий в UnifiedSessionLoader.
   */
  async getAllDocumentSittings(customUid?: string): Promise<Map<string, import('../../types').SessionSitting[]>> {
    const db = await getLocalDb(customUid);
    const tx = db.transaction('versions', 'readonly');
    const index = tx.store.index('by-doc-version');
    let cursor = await index.openCursor();
    const map = new Map<string, import('../../types').SessionSitting[]>();
    while (cursor) {
      const v = cursor.value;
      const docId = v.documentId;
      if (docId) {
        let list = map.get(docId);
        if (!list) {
          list = [];
          map.set(docId, list);
        }
        list.push({
          id: v.id,
          documentId: v.documentId,
          version: v.version,
          sessionStartedAt: v.sessionStartedAt,
          savedAt: v.savedAt,
          wordsAdded: typeof v.wordsAdded === 'number' ? v.wordsAdded : 0,
          duration: typeof v.duration === 'number' ? v.duration : 0,
        });
      }
      cursor = await cursor.continue();
    }
    return map;
  },
};
