import { DataProvider } from '../data';
import { Document } from '../../types';
import { toTimestampMs } from '../utils/dateUtils';
import { reportError } from '../../shared/errors/reportError';
import { documentDbSchema } from '../data/schemas';
import { documentFromDb } from './mappers';
import { maybeEncrypt, maybeDecrypt } from '../crypto/cryptoHelpers';

export const DocumentService = {
  async createDocument(
    userId: string,
    data: Pick<Document, 'title' | 'tags' | 'labelId'> & {
      uuid?: string | undefined;
      firstSessionAt?: Date | undefined;
      lastSessionAt?: Date | undefined;
      mood?: string | undefined;
      excludedFromAI?: boolean | undefined;
    }
  ): Promise<string> {
    const rawPayload: Record<string, unknown> = {
      title: data.title,
      currentVersion: 0,
      totalWords: 0,
      totalDuration: 0,
      sessionsCount: 0,
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

  async getDocument(userId: string, documentId: string): Promise<Document | null> {
    const data = await DataProvider.getDocument(userId, documentId);
    if (!data) return null;
    const decrypted = await maybeDecrypt(data, ['title', 'mood'], ['tags']);
    const parsed = documentDbSchema.safeParse({ id: documentId, ...decrypted });
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
        try {
          const decrypted = await maybeDecrypt(d, ['title', 'mood'], ['tags']);
          const parsed = documentDbSchema.safeParse({ id: d.id, ...decrypted });
          if (!parsed.success) {
            reportError(parsed.error, { action: 'getUserDocuments_parse', docId: d.id as string });
            return null;
          }
          return documentFromDb(parsed.data);
        } catch (e) {
          reportError(e, { action: 'getUserDocuments_decrypt', docId: d.id as string });
          return null;
        }
      })
    );
    const docs = decryptedDocs.filter((d): d is Document => d !== null);
    docs.sort((a, b) => (toTimestampMs(b.lastSessionAt) ?? 0) - (toTimestampMs(a.lastSessionAt) ?? 0));
    return docs;
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

  async updateDate(userId: string, documentId: string, firstSessionAt: Date, lastSessionAt: Date): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, {
      firstSessionAt: firstSessionAt.getTime(),
      lastSessionAt: lastSessionAt.getTime(),
    });
  },

  async updateLabelId(userId: string, documentId: string, labelId: string | undefined): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { labelId: labelId ?? null });
  },

  async updateExcludedFromAI(userId: string, documentId: string, excludedFromAI: boolean): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { excludedFromAI });
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
