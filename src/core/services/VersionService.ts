import { DataProvider } from '../data';
import { Version } from '../../types';
import { computeWordDelta } from './DiffService';
import { reportError } from '../../shared/errors/reportError';
import { versionDbSchema, MAX_VERSION_CONTENT_CHARS } from '../data/schemas';
import { getEncryptionEnabled } from '../crypto/cryptoHelpers';

export { MAX_VERSION_CONTENT_CHARS };

export function estimateVersionDocSize(content: string, isEncrypted: boolean, alreadyEncrypted = false): number {
  if (!isEncrypted) return content.length;
  if (alreadyEncrypted) return content.length;
  return Math.ceil((new TextEncoder().encode(content).length + 28) * 4 / 3);
}

export function isVersionContentTooLarge(content: string, isEncrypted: boolean, alreadyEncrypted = false): boolean {
  return estimateVersionDocSize(content, isEncrypted, alreadyEncrypted) > MAX_VERSION_CONTENT_CHARS;
}

export const VersionService = {

  async addVersion(
    userId: string,
    documentId: string,
    data: {
      content: string;
      previousContent: string;
      wordCount: number;
      wordsAdded?: number | undefined;
      charsAdded?: number | undefined;
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
    // T-3: predict what the server measures — length(content) in characters.
    // Ciphertext is base64 of the UTF-8 bytes plus IV and tag, so a Cyrillic
    // note grows ~2.7x; plaintext is stored as typed, so its character count is
    // the number. The old estimate (bytes x 1.35 + previousContent + 10 KB) was
    // the Firestore 1 MiB document budget and measured neither.
    const isEncrypted = Boolean(data._encrypted || getEncryptionEnabled(userId));
    const estimatedDocSize = estimateVersionDocSize(data.content, isEncrypted, Boolean(data._encrypted));
    if (estimatedDocSize > MAX_VERSION_CONTENT_CHARS) {
      throw new Error(`Document too large for cloud sync (${(estimatedDocSize / 1024).toFixed(0)}KB estimated). Consider splitting into multiple documents.`);
    }
    const diff = (data.wordsAdded !== undefined && data.charsAdded !== undefined)
      ? { wordsAdded: data.wordsAdded, charsAdded: data.charsAdded }
      : (data._encrypted ? { wordsAdded: 0, charsAdded: 0 } : computeWordDelta(data.previousContent, data.content));
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
    const records = await DataProvider.getVersions(userId, documentId);
    const versions = records
      .map(d => {
        const parsed = versionDbSchema.safeParse({ id: d.id, ...d });
        if (!parsed.success) {
          reportError(parsed.error, { action: 'getVersions_parse', docId: d.id as string });
          // Деградированная запись: собираем только из полей с проверенным
          // типом и помечаем — повреждённая версия, которую видно, лучше той,
          // что притворяется здоровой.
          const r = d as Record<string, unknown>;
          const str = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);
          const num = (v: unknown, fb = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
          const savedAt = num(r.savedAt, Date.now());
          return {
            id: str(d.id),
            documentId: str(r.documentId, documentId),
            version: num(r.version),
            content: str(r.content),
            wordCount: num(r.wordCount),
            duration: num(r.duration),
            wpm: num(r.wpm),
            wordsAdded: num(r.wordsAdded),
            charsAdded: num(r.charsAdded),
            goalReached: r.goalReached === true,
            savedAt: new Date(savedAt),
            sessionStartedAt: new Date(num(r.sessionStartedAt, savedAt)),
            ...(r._encrypted === true ? { _encrypted: true } : {}),
            _degraded: true,
          } as Version;
        }
        return parsed.data as Version;
      })
      .filter((v): v is Version => v !== null);
    versions.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    return versions;
  },

  async getAllVersionsForUser(userId: string): Promise<Version[]> {
    if (!DataProvider.getAllVersionsForUser) return [];
    const records = await DataProvider.getAllVersionsForUser(userId);
    const versions = records
      .map(d => {
        const parsed = versionDbSchema.safeParse({ id: d.id, ...d });
        if (!parsed.success) {
          reportError(parsed.error, { action: 'getAllVersionsForUser_parse', docId: d.id as string });
          const r = d as Record<string, unknown>;
          const str = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);
          const num = (v: unknown, fb = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
          const savedAt = num(r.savedAt, Date.now());
          return {
            id: str(d.id),
            documentId: str(r.documentId),
            version: num(r.version),
            content: str(r.content),
            wordCount: num(r.wordCount),
            duration: num(r.duration),
            wpm: num(r.wpm),
            wordsAdded: num(r.wordsAdded),
            charsAdded: num(r.charsAdded),
            goalReached: r.goalReached === true,
            savedAt: new Date(savedAt),
            sessionStartedAt: new Date(num(r.sessionStartedAt, savedAt)),
            ...(r._encrypted === true ? { _encrypted: true } : {}),
            _degraded: true,
          } as Version;
        }
        return parsed.data as Version;
      })
      .filter((v): v is Version => v !== null);
    versions.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    return versions;
  },

  async getLatestContent(userId: string, documentId: string): Promise<string> {
    const raw = await DataProvider.getLatestVersion(userId, documentId);
    if (!raw) return '';
    const parsed = versionDbSchema.safeParse({ id: raw.id, ...raw });
    if (!parsed.success) {
      reportError(parsed.error, { action: 'getLatestContent_parse', docId: documentId });
      return '';
    }
    return parsed.data.content || '';
  },

  /** null = версии нет; PARSE_FAILED = версия есть, но не читается. Слитно эти
   *  два случая путал «заметка пуста» с «заметка нечитаема»: экспорт писал
   *  пустой файл и рапортовал об успехе (AUD-5). */
  async getLatestVersion(userId: string, documentId: string): Promise<Version | 'PARSE_FAILED' | null> {
    const raw = await DataProvider.getLatestVersion(userId, documentId);
    if (!raw) return null;
    const parsed = versionDbSchema.safeParse({ id: raw.id, ...raw });
    if (!parsed.success) {
      reportError(parsed.error, { action: 'getLatestVersion_parse', docId: documentId });
      return 'PARSE_FAILED';
    }
    return parsed.data as Version;
  },
};
