import { DataProvider } from '../data';
import { Document } from '../../types';
import { toTimestampMs } from '../utils/dateUtils';
import { reportError } from '../../shared/errors/reportError';
import { documentDbSchema } from '../data/schemas';
import { documentFromDb } from './mappers';
import { maybeEncrypt, maybeDecrypt, DecryptionError } from '../crypto/cryptoHelpers';

export const DocumentService = {
  async createDocument(
    userId: string,
    data: Pick<Document, 'title' | 'tags' | 'labelId'> & {
      uuid?: string | undefined;
      firstSessionAt?: Date | undefined;
      lastSessionAt?: Date | undefined;
      mood?: string | undefined;
      excludedFromAI?: boolean | undefined;
      currentVersion?: number | undefined;
      totalWords?: number | undefined;
      totalDuration?: number | undefined;
      sessionsCount?: number | undefined;
      _locked?: boolean | undefined;
      _decryptionError?: boolean | undefined;
    }
  ): Promise<string> {
    if (data._locked || data._decryptionError) {
      throw new Error('LOCKED: cannot create locked document in cloud');
    }
    const rawPayload: Record<string, unknown> = {
      title: data.title ?? '',
      currentVersion: data.currentVersion ?? 0,
      totalWords: data.totalWords ?? 0,
      totalDuration: data.totalDuration ?? 0,
      sessionsCount: data.sessionsCount ?? 0,
      firstSessionAt: data.firstSessionAt ? data.firstSessionAt.getTime() : Date.now(),
      lastSessionAt: data.lastSessionAt ? data.lastSessionAt.getTime() : Date.now(),
      tags: data.tags ?? [],
      labelId: data.labelId ?? null,
      mood: data.mood ?? null,
      excludedFromAI: data.excludedFromAI ?? false,
    };
    if (data.uuid) rawPayload.uuid = data.uuid;

    const payload = await maybeEncrypt(rawPayload, ['title', 'mood'], ['tags'], userId);
    return DataProvider.createDocument(userId, payload);
  },

  async findByUuid(userId: string, uuid: string): Promise<Document | null> {
    return DocumentService.getDocument(userId, uuid);
  },

  async getDocument(userId: string, documentId: string): Promise<Document | null> {
    const data = await DataProvider.getDocument(userId, documentId);
    if (!data) return null;
    let decrypted: Record<string, unknown> = data;
    let _locked = false;
    let _decryptionError = false;
    try {
      decrypted = await maybeDecrypt(data, ['title', 'mood'], ['tags']);
    } catch (decErr) {
      if (decErr instanceof DecryptionError) {
        _decryptionError = true;
      } else if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) {
        _locked = true;
      } else {
        reportError(decErr, { action: 'getDocument_decrypt', docId: documentId });
        return null;
      }
    }
    const docData: Record<string, unknown> = { ...decrypted };
    if (_locked || _decryptionError) {
      delete docData.title;
      delete docData.tags;
      delete docData.mood;
      if (_locked) docData._locked = true;
      if (_decryptionError) docData._decryptionError = true;
    }
    const parsed = documentDbSchema.safeParse({ id: documentId, ...docData });
    if (!parsed.success) {
      reportError(parsed.error, { action: 'getDocument_parse', docId: documentId });
      return null;
    }
    return documentFromDb(parsed.data);
  },

  async getDocumentWithDeleted(userId: string, documentId: string): Promise<Document | null> {
    const data = await DataProvider.getDocumentWithDeleted(userId, documentId);
    if (!data) return null;
    let decrypted: Record<string, unknown> = data;
    let _locked = false;
    let _decryptionError = false;
    try {
      decrypted = await maybeDecrypt(data, ['title', 'mood'], ['tags']);
    } catch (decErr) {
      if (decErr instanceof DecryptionError) {
        _decryptionError = true;
      } else if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) {
        _locked = true;
      } else {
        reportError(decErr, { action: 'getDocument_decrypt', docId: documentId });
        return null;
      }
    }
    const docData: Record<string, unknown> = { ...decrypted };
    if (_locked || _decryptionError) {
      delete docData.title;
      delete docData.tags;
      delete docData.mood;
      if (_locked) docData._locked = true;
      if (_decryptionError) docData._decryptionError = true;
    }
    const parsed = documentDbSchema.safeParse({ id: documentId, ...docData });
    if (!parsed.success) {
      reportError(parsed.error, { action: 'getDocument_parse', docId: documentId });
      return null;
    }
    return documentFromDb(parsed.data);
  },

  async getUserDocuments(userId: string): Promise<Document[]> {
    const records = await DataProvider.getUserDocuments(userId);
    const decryptedDocs = await Promise.all(
      records.map(async d => {
        let _locked = false;
        let _decryptionError = false;
        let decrypted: Record<string, unknown> = d;
        try {
          decrypted = await maybeDecrypt(d, ['title', 'mood'], ['tags']);
        } catch (decErr) {
          if (decErr instanceof DecryptionError) {
            _decryptionError = true;
          } else if (decErr instanceof Error && decErr.message.startsWith('LOCKED')) {
            _locked = true;
          } else {
            reportError(decErr, { action: 'getUserDocuments_decrypt', docId: d.id as string });
            return null;
          }
        }
        const docData: Record<string, unknown> = { ...decrypted };
        if (_locked || _decryptionError) {
          delete docData.title;
          delete docData.tags;
          delete docData.mood;
          if (_locked) docData._locked = true;
          if (_decryptionError) docData._decryptionError = true;
        }
        const parsed = documentDbSchema.safeParse({ id: d.id, ...docData });
        if (!parsed.success) {
          reportError(parsed.error, { action: 'getUserDocuments_parse', docId: d.id as string });
          return null;
        }
        return documentFromDb(parsed.data);
      })
    );
    const docs = decryptedDocs.filter((d): d is Document => d !== null);
    docs.sort((a, b) => (toTimestampMs(b.lastSessionAt) ?? 0) - (toTimestampMs(a.lastSessionAt) ?? 0));
    return docs;
  },

  async getCloudDocumentVersions(userId: string): Promise<Map<string, number>> {
    try {
      const records = await DataProvider.getUserDocuments(userId);
      const map = new Map<string, number>();
      for (const r of records) {
        const id = (r.uuid as string) || (r.id as string);
        if (id) {
          map.set(id, typeof r.currentVersion === 'number' ? r.currentVersion : 0);
        }
      }
      return map;
    } catch {
      const docs = await DocumentService.getUserDocuments(userId);
      const map = new Map<string, number>();
      for (const d of docs) {
        if (d.id) {
          map.set(d.id, d.currentVersion ?? 0);
        }
      }
      return map;
    }
  },

  async getCloudVersionDiscrepancyCount(userId: string): Promise<number> {
    // R4-7: ошибку не глотаем — диагностика показывает «облако не прочитано».
    if (typeof DataProvider.getCloudVersionDiscrepancyCount === 'function') {
      return DataProvider.getCloudVersionDiscrepancyCount(userId);
    }
    return 0;
  },

  async updateDocumentAfterSession(
    userId: string,
    documentId: string,
    data: {
      totalWords: number;
      totalDuration: number;
      currentVersion: number;
      mood?: string | undefined;
      sessionsCount?: number | undefined;
      lastSessionAt?: Date | undefined;
    }
  ): Promise<void> {
    const payload: Parameters<typeof DataProvider.updateDocumentSessionStats>[2] = {
      totalWords: data.totalWords,
      totalDuration: data.totalDuration,
      currentVersion: data.currentVersion,
      mood: data.mood ?? null,
    };
    if (data.sessionsCount !== undefined) payload.sessionsCount = data.sessionsCount;
    if (data.lastSessionAt !== undefined) payload.lastSessionAt = data.lastSessionAt;

    if (data.mood) {
      const encrypted = await maybeEncrypt({ mood: data.mood }, ['mood'], [], userId);
      payload.mood = (encrypted.mood as string) ?? null;
    }

    await DataProvider.updateDocumentSessionStats(userId, documentId, payload);
  },

  async updateTags(userId: string, documentId: string, tags: string[]): Promise<void> {
    const encrypted = await maybeEncrypt({ tags }, [], ['tags'], userId);
    await DataProvider.updateDocument(userId, documentId, encrypted);
  },

  async updateTitle(userId: string, documentId: string, title: string): Promise<void> {
    const encrypted = await maybeEncrypt({ title }, ['title'], [], userId);
    await DataProvider.updateDocument(userId, documentId, encrypted);
  },

  /** Облачный двойник LocalDocumentService.updateDate: начало истории меняется
   *  только явно, иначе следующий синк принёс бы затёртое значение обратно. */
  async updateDate(
    userId: string,
    documentId: string,
    dates: { lastSessionAt: Date; firstSessionAt?: Date },
  ): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, {
      lastSessionAt: dates.lastSessionAt.getTime(),
      ...(dates.firstSessionAt !== undefined ? { firstSessionAt: dates.firstSessionAt.getTime() } : {}),
    });
  },

  /** R3-1: повтор неудавшейся правки метаданных — всё одним запросом. */
  async updateMetadata(
    userId: string,
    documentId: string,
    meta: { title: string; tags: string[]; labelId?: string | undefined; excludedFromAI?: boolean | undefined; lastSessionAt?: number | undefined },
  ): Promise<void> {
    const encrypted = await maybeEncrypt({ title: meta.title, tags: meta.tags }, ['title'], ['tags'], userId);
    await DataProvider.updateDocument(userId, documentId, {
      ...encrypted,
      labelId: meta.labelId ?? null,
      excludedFromAI: meta.excludedFromAI === true,
      ...(meta.lastSessionAt !== undefined ? { lastSessionAt: meta.lastSessionAt } : {}),
    });
  },

  async updateLabelId(userId: string, documentId: string, labelId: string | undefined): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { labelId: labelId ?? null });
  },

  async updateExcludedFromAI(userId: string, documentId: string, excludedFromAI: boolean): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { excludedFromAI });
  },

  async trashDocument(userId: string, documentId: string, trashedAt: Date = new Date()): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { trashedAt });
  },

  async restoreDocument(userId: string, documentId: string): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { trashedAt: null });
  },

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    await DataProvider.deleteDocument(userId, documentId);
  },

  async clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
    await DataProvider.clearLabelFromAllDocs(userId, labelId);
  },

  async renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
    await DataProvider.renameTagInAllDocs(userId, oldTag, newTag);
  },

  async removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
    await DataProvider.removeTagFromAllDocs(userId, tag);
  },
};
