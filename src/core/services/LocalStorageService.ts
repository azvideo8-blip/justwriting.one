import { LocalDocumentService } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb, randomUUID, LocalDocument } from '../storage/localDb';
import { computeWordDelta } from './DiffService';
import { reportError } from '../../shared/errors/reportError';
import { SaveDocumentData } from './storageTypes';

export const LocalStorageService = {
  async saveNew(userId: string, data: SaveDocumentData): Promise<{ localId: string }> {
    const db = await getLocalDb();
    const localId = `local_${randomUUID()}`;
    const versionId = `ver_${randomUUID()}`;
    const now = Date.now();
    const diff = computeWordDelta('', data.content);
    const totalWords = data.documentWordCount ?? data.wordCount;

    const docObj = {
      id: localId,
      guestId: userId,
      title: data.title || '',
      currentVersion: 1,
      totalWords,
      totalDuration: data.duration,
      sessionsCount: 1,
      firstSessionAt: now,
      lastSessionAt: now,
      tags: data.tags ?? [],
      labelId: data.labelId ?? undefined,
      mood: data.mood,
    };
    const verObj = {
      id: versionId,
      documentId: localId,
      guestId: userId,
      version: 1,
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
    };
    // Document and its first version in ONE transaction. As three separate
    // writes, a crash in between left either a note with no versions (opens
    // empty) or a note whose counters say it is empty while the text exists —
    // and the first save is exactly when a new user is most likely to close the
    // tab. Continuation already does this atomically; the first save must too.
    const tx = db.transaction(['documents', 'versions'], 'readwrite');
    await tx.objectStore('documents').put(docObj);
    await tx.objectStore('versions').put(verObj);
    await tx.done;

    // Profile totals are an aggregate: recomputed after the fact, never a reason
    // to hold the note's own write open.
    try {
      await LocalDocumentService.recomputeProfileTotals(userId);
    } catch (e) {
      reportError(e, { action: 'saveNew_profileTotals', userId });
    }

    return { localId };
  },

  async saveVersionToLocal(
    db: Awaited<ReturnType<typeof getLocalDb>>,
    documentId: string,
    data: SaveDocumentData,
    now: number
  ): Promise<{ ok: true; newVersion: number; prevContent: string; existing: LocalDocument } | { ok: false }> {
    const tx = db.transaction(['documents', 'versions'], 'readwrite');
    const docStore = tx.objectStore('documents');
    const verStore = tx.objectStore('versions');

    // Read the document and its previous version INSIDE the write transaction so
    // the version number and the base snapshot are consistent with what we write
    // — a concurrent (cross-tab) save/sync cannot slip in between, so we never
    // revert a freshly-set linkedCloudId or reuse a version number.
    const existing = await docStore.get(documentId);
    if (!existing) {
      await tx.done;
      throw new Error('Document not found');
    }
    const newVersion = existing.currentVersion + 1;
    const prevVer = await verStore.index('by-doc-version').get([documentId, existing.currentVersion]);
    const prevContent = prevVer?.content ?? '';

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
        // Metadata edited during the session travels in the same payload as the
        // text and must be persisted in the same write. Only counters were
        // written before, so a title or tag changed while continuing a note was
        // silently discarded on reload.
        title: data.title || existing.title,
        tags: data.tags ?? existing.tags,
        labelId: data.labelId ?? existing.labelId,
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
        return { ok: false };
      } else {
        reportError(localErr, { action: 'saveVersionToLocal_localSave', documentId });
        throw localErr;
      }
    }
    return { ok: true, newVersion, prevContent, existing };
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
