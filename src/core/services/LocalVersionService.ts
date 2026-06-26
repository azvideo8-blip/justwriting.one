import { getLocalDb, LocalVersion, randomUUID } from '../storage/localDb';
import { computeWordDelta } from './DiffService';

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

  // Keep only the latest version row for a document, deleting older ones.
  // Cosmetic: the latest content is untouched (it's what every read already uses).
  // Returns how many version rows were removed.
  async collapseToLatest(documentId: string): Promise<number> {
    const db = await getLocalDb();
    const all = await db.getAllFromIndex('versions', 'by-document', documentId);
    if (all.length <= 1) return 0;
    all.sort((a, b) => a.version - b.version);
    const keep = all[all.length - 1];
    const tx = db.transaction('versions', 'readwrite');
    let deleted = 0;
    await Promise.all(
      all.filter(v => keep && v.id !== keep.id).map(v => { deleted++; return tx.store.delete(v.id); })
    );
    await tx.done;
    return deleted;
  },

  async getLatestContent(documentId: string): Promise<string> {
    const db = await getLocalDb();
    const tx = db.transaction('versions', 'readonly');
    const index = tx.store.index('by-doc-version');
    const range = IDBKeyRange.bound([documentId, 0], [documentId, Number.MAX_SAFE_INTEGER]);
    const cursor = await index.openCursor(range, 'prev');
    return cursor?.value.content ?? '';
  },
};
