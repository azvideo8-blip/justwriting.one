import { DataProvider } from '../data';
import { Version } from '../../types';
import { computeWordDelta } from './DiffService';
import { reportError } from '../../shared/errors/reportError';
import { versionDbSchema } from '../firebase/schemas/firestoreSchemas';
import { assertReadBudget, spendReadBudget } from '../firebase/readBudget';
export const VersionService = {
  async addVersion(
    userId: string,
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
      _encrypted?: boolean | undefined;
      mood?: string | undefined;
    }
  ): Promise<string> {
    const contentSize = new TextEncoder().encode(data.content).length;
    const prevContentSize = new TextEncoder().encode(data.previousContent || '').length;
    const estimatedDocSize = Math.ceil((contentSize + prevContentSize) * 1.35) + 10_000;
    if (estimatedDocSize > 900_000) {
      throw new Error(`Document too large for cloud sync (${(estimatedDocSize / 1024).toFixed(0)}KB estimated). Consider splitting into multiple documents.`);
    }
    const diff = computeWordDelta(data.previousContent, data.content);
    const doc: Record<string, unknown> = {
      documentId,
      userId,
      version: data.versionNumber,
      content: data.content,
      wordCount: data.wordCount,
      wordsAdded: diff.wordsAdded,
      charsAdded: diff.charsAdded,
      duration: data.duration,
      wpm: data.wpm,
      goalWords: data.goalWords ?? null,
      goalTime: data.goalTime ?? null,
      goalReached: data.goalReached ?? false,
      savedAt: data.savedAt ? data.savedAt.getTime() : Date.now(),
      sessionStartedAt: data.sessionStartedAt.getTime(),
    };
    if (data._encrypted) doc._encrypted = true;
    if (data.mood) doc.mood = data.mood;
    const versionDocId = `v${data.versionNumber}`;
    await DataProvider.addVersion(userId, documentId, versionDocId, doc);
    return versionDocId;
  },

  async getVersions(userId: string, documentId: string): Promise<Version[]> {
    assertReadBudget('VersionService.getVersions');
    const records = await DataProvider.getVersions(userId, documentId);
    spendReadBudget(records.length || 1, 'VersionService.getVersions');
    const versions = records
      .map(d => {
        const parsed = versionDbSchema.safeParse({ id: d.id, ...d });
        if (!parsed.success) {
          reportError(parsed.error, { action: 'getVersions_parse', docId: d.id as string });
          const rawData = d as Record<string, unknown>;
          return { id: d.id, documentId: rawData.documentId ?? documentId, version: rawData.version ?? 0, content: rawData.content ?? '', wordCount: rawData.wordCount ?? 0, duration: rawData.duration ?? 0, wpm: rawData.wpm ?? 0, wordsAdded: rawData.wordsAdded ?? 0, charsAdded: rawData.charsAdded ?? 0, goalReached: rawData.goalReached ?? false, savedAt: rawData.savedAt ?? null, sessionStartedAt: rawData.sessionStartedAt ?? null, ...(rawData._encrypted === true ? { _encrypted: true } : {}) } as Version;
        }
        return parsed.data as Version;
      })
      .filter((v): v is Version => v !== null);
    versions.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    return versions;
  },

  async getLatestContent(userId: string, documentId: string): Promise<string> {
    assertReadBudget('VersionService.getLatestContent');
    const raw = await DataProvider.getLatestVersion(userId, documentId);
    spendReadBudget(1, 'VersionService.getLatestContent');
    if (!raw) return '';
    const parsed = versionDbSchema.safeParse({ id: raw.id, ...raw });
    if (!parsed.success) {
      reportError(parsed.error, { action: 'getLatestContent_parse', docId: documentId });
      return '';
    }
    return parsed.data.content || '';
  },

  async getLatestVersion(userId: string, documentId: string): Promise<Version | null> {
    assertReadBudget('VersionService.getLatestVersion');
    const raw = await DataProvider.getLatestVersion(userId, documentId);
    spendReadBudget(1, 'VersionService.getLatestVersion');
    if (!raw) return null;
    const parsed = versionDbSchema.safeParse({ id: raw.id, ...raw });
    if (!parsed.success) {
      reportError(parsed.error, { action: 'getLatestVersion_parse', docId: documentId });
      return null;
    }
    return parsed.data as Version;
  },
};
