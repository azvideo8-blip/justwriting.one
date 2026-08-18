import { DataProvider } from '../data';
import { Document } from '../../types';
import { toTimestampMs } from '../utils/dateUtils';
import { reportError } from '../../shared/errors/reportError';
import { documentDbSchema } from '../data/schemas';
import { documentFromDb } from './mappers';

export const DocumentService = {
  async createDocument(
    userId: string,
    data: Pick<Document, 'title' | 'tags' | 'labelId'> & {
      uuid?: string | undefined;
      firstSessionAt?: Date | undefined;
      lastSessionAt?: Date | undefined;
    }
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      title: data.title,
      currentVersion: 0,
      totalWords: 0,
      totalDuration: 0,
      sessionsCount: 0,
      firstSessionAt: data.firstSessionAt ? data.firstSessionAt.getTime() : Date.now(),
      lastSessionAt: data.lastSessionAt ? data.lastSessionAt.getTime() : Date.now(),
      tags: data.tags ?? [],
      labelId: data.labelId ?? null,
    };
    if (data.uuid) payload.uuid = data.uuid;
    return DataProvider.createDocument(userId, payload);
  },

  async getDocument(userId: string, documentId: string): Promise<Document | null> {
    const data = await DataProvider.getDocument(userId, documentId);
    if (!data) return null;
    const parsed = documentDbSchema.safeParse({ id: documentId, ...data });
    if (!parsed.success) {
      reportError(parsed.error, { action: 'getDocument_parse', docId: documentId });
      return null;
    }
    return documentFromDb(parsed.data);
  },

  async getUserDocuments(userId: string): Promise<Document[]> {
    const records = await DataProvider.getUserDocuments(userId);
    const docs = records
      .map(d => {
        const parsed = documentDbSchema.safeParse({ id: d.id, ...d });
        if (!parsed.success) {
          reportError(parsed.error, { action: 'getUserDocuments_parse', docId: d.id as string });
          return null;
        }
        return documentFromDb(parsed.data);
      })
      .filter((d): d is Document => d !== null);
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
    
    await DataProvider.updateDocumentSessionStats(userId, documentId, payload);
  },

  async updateTags(userId: string, documentId: string, tags: string[]): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { tags });
  },

  async updateTitle(userId: string, documentId: string, title: string): Promise<void> {
    await DataProvider.updateDocument(userId, documentId, { title });
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
