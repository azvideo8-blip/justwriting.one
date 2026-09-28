import { LocalDocumentService, type DeleteDocumentCloudOptions } from './LocalDocumentService';
import { LocalVersionService } from './LocalVersionService';
import { getLocalDb, randomUUID, LocalDocument } from '../storage/localDb';
import { computeWordDelta } from './DiffService';
import { reportError } from '../../shared/errors/reportError';
import { SaveDocumentData } from './storageTypes';
import { getEncryptionEnabled } from '../crypto/cryptoHelpers';
import { isVersionContentTooLarge } from './VersionService';
import { requestPersistentStorageOnce } from '../storage/storagePersistence';

export const LocalStorageService = {
  async saveNew(userId: string, data: SaveDocumentData & { _locked?: boolean | undefined; _decryptionError?: boolean | undefined }): Promise<{ localId: string }> {
    if (data._locked || data._decryptionError) {
      throw new Error('LOCKED: cannot save locked document to local storage');
    }
    const db = await getLocalDb(userId);
    const localId = `local_${randomUUID()}`;
    const versionId = `ver_${randomUUID()}`;
    const now = Date.now();
    // D-4: импорт старого дневника несёт дату в самом файле. Список заметок,
    // календарь, стрик и «в этот день» считаются по firstSessionAt/lastSessionAt
    // документа (см. UnifiedSessionLoader) и по savedAt версии, поэтому заметка
    // обязана получить дату файла, а не момент импорта. Сохранение сессии
    // documentDate не передаёт — там дата заметки равна моменту записи.
    const datedAt = data.documentDate ? data.documentDate.getTime() : now;
    const diff = computeWordDelta('', data.content);
    const totalWords = data.documentWordCount ?? data.wordCount;
    const isEncrypted = Boolean(getEncryptionEnabled(userId));
    const isTooLarge = isVersionContentTooLarge(data.content, isEncrypted);

    const docObj: LocalDocument = {
      id: localId,
      uuid: randomUUID(),
      guestId: userId,
      title: data.title || '',
      currentVersion: 1,
      totalWords,
      totalDuration: data.duration,
      sessionsCount: 1,
      firstSessionAt: datedAt,
      lastSessionAt: datedAt,
      tags: data.tags ?? [],
      labelId: data.labelId ?? undefined,
      mood: data.mood,
      ...(isTooLarge ? { isTooLargeForSync: true } : {}),
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
      savedAt: datedAt,
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

    void requestPersistentStorageOnce().catch(() => { /* намеренно: просьба к браузеру, запись от отказа не зависит */ });

    // Profile totals are an aggregate: recomputed after the fact, never a reason
    // to hold the note's own write open.
    try {
      await LocalDocumentService._updateProfile(userId);
    } catch (e) {
      reportError(e, { action: 'saveNew_profileTotals', userId });
    }

    return { localId };
  },

  async saveVersionToLocal(
    db: Awaited<ReturnType<typeof getLocalDb>>,
    documentId: string,
    data: SaveDocumentData & { _locked?: boolean | undefined; _decryptionError?: boolean | undefined },
    now: number
  ): Promise<{ ok: true; newVersion: number; prevContent: string; existing: LocalDocument } | { ok: false }> {
    if (data._locked || data._decryptionError) {
      throw new Error('LOCKED: cannot save locked version to local storage');
    }
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

      const isEncrypted = Boolean(getEncryptionEnabled(existing.guestId));
      const isTooLarge = isVersionContentTooLarge(data.content, isEncrypted);

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
        totalDuration: data.documentDuration ?? (existing.totalDuration ? existing.totalDuration + data.duration : data.duration),
        currentVersion: newVersion,
        sessionsCount: (existing.sessionsCount || 0) + 1,
        lastSessionAt: now,
        mood: data.mood,
        isTooLargeForSync: isTooLarge ? true : undefined,
      });

      await tx.done;
    } catch (localErr) {
      await tx.done.catch(() => { /* намеренно: исходная ошибка разбирается ниже */ });
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

  async getDocument(localId: string, ownerId?: string) {
    return LocalDocumentService.getDocument(localId, ownerId);
  },

  async getVersions(localId: string, ownerId?: string) {
    return LocalVersionService.getVersions(localId, ownerId);
  },

  async deleteDocument(localId: string, ownerId?: string, cloud?: DeleteDocumentCloudOptions): Promise<boolean> {
    return LocalDocumentService.deleteDocument(localId, ownerId, cloud);
  },

  async createDocument(userId: string, data: Parameters<typeof LocalDocumentService.createDocument>[1]) {
    return LocalDocumentService.createDocument(userId, data);
  },

  async updateDocument(localId: string, data: Parameters<typeof LocalDocumentService.updateDocument>[1], ownerId?: string) {
    await LocalDocumentService.updateDocument(localId, data, ownerId);
  },

  async updateAfterSession(localId: string, data: Parameters<typeof LocalDocumentService.updateAfterSession>[1], ownerId?: string) {
    await LocalDocumentService.updateAfterSession(localId, data, ownerId);
  },

  async updateLinkedCloudId(localId: string, cloudId: string, ownerId?: string) {
    await LocalDocumentService.updateLinkedCloudId(localId, cloudId, ownerId);
  },

  async unlinkFromCloud(localId: string, reason?: 'user_choice' | 'tombstone', ownerId?: string) {
    await LocalDocumentService.unlinkFromCloud(localId, reason, ownerId);
  },

  async migrateDocumentOwner(localId: string, userId: string, ownerId?: string) {
    await LocalDocumentService.migrateDocumentOwner(localId, userId, ownerId);
  },

  async getDocumentsByOwner(userId: string) {
    return LocalDocumentService.getDocumentsByOwner(userId);
  },
};
