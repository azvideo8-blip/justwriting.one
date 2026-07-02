import { getClient } from '../firebase/firestoreClient';
import { Version } from '../../types';
import { handleFirestoreError, OperationType } from '../errors/firestore-errors';
import { computeWordDelta } from './DiffService';
import { reportError } from '../../shared/errors/reportError';
import { versionDbSchema } from '../firebase/schemas/firestoreSchemas';

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
    try {
      const { db, mod } = await getClient();
      const { collection, addDoc, Timestamp } = mod;
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
        savedAt: data.savedAt ? Timestamp.fromDate(data.savedAt) : Timestamp.now(),
        sessionStartedAt: Timestamp.fromDate(data.sessionStartedAt),
      };
      if (data._encrypted) doc._encrypted = true;
      if (data.mood) doc.mood = data.mood;
      const ref = await addDoc(collection(db, 'users', userId, 'documents', documentId, 'versions'), doc);
      return ref.id;
    } catch (e) {
      reportError(e, { action: 'addVersion', userId, documentId });
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },

  async getVersions(userId: string, documentId: string): Promise<Version[]> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs } = mod;
      const snap = await getDocs(collection(db, 'users', userId, 'documents', documentId, 'versions'));
      const versions = snap.docs
        .map(d => {
          const parsed = versionDbSchema.safeParse({ id: d.id, ...d.data() });
          if (!parsed.success) {
            reportError(parsed.error, { action: 'getVersions_parse', docId: d.id });
            const rawData = d.data() as Record<string, unknown>;
            return { id: d.id, documentId: rawData.documentId ?? documentId, version: rawData.version ?? 0, content: rawData.content ?? '', wordCount: rawData.wordCount ?? 0, duration: rawData.duration ?? 0, wpm: rawData.wpm ?? 0, wordsAdded: rawData.wordsAdded ?? 0, charsAdded: rawData.charsAdded ?? 0, goalReached: rawData.goalReached ?? false, savedAt: rawData.savedAt ?? null, sessionStartedAt: rawData.sessionStartedAt ?? null, ...(rawData._encrypted === true ? { _encrypted: true } : {}) } as Version;
          }
          return parsed.data as Version;
        })
        .filter((v): v is Version => v !== null);
      versions.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
      return versions;
    } catch (e) {
      reportError(e, { action: 'getVersions', userId, documentId });
      handleFirestoreError(e, OperationType.LIST, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },

  async getLatestContent(userId: string, documentId: string): Promise<string> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs, query, orderBy, limit } = mod;
      const q = query(collection(db, 'users', userId, 'documents', documentId, 'versions'), orderBy('version', 'desc'), limit(1));
      const snap = await getDocs(q);
      if (snap.docs.length === 0) return '';
      const raw = snap.docs[0];
      if (!raw) return '';
      const parsed = versionDbSchema.safeParse({ id: raw.id, ...raw.data() });
      if (!parsed.success) {
        reportError(parsed.error, { action: 'getLatestContent_parse', docId: documentId });
        return '';
      }
      return parsed.data.content || '';
    } catch (e) {
      reportError(e, { action: 'getLatestContent', userId, documentId });
      handleFirestoreError(e, OperationType.LIST, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },

  async getLatestVersion(userId: string, documentId: string): Promise<Version | null> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs, query, orderBy, limit } = mod;
      const q = query(collection(db, 'users', userId, 'documents', documentId, 'versions'), orderBy('version', 'desc'), limit(1));
      const snap = await getDocs(q);
      if (snap.docs.length === 0) return null;
      const raw = snap.docs[0];
      if (!raw) return null;
      const parsed = versionDbSchema.safeParse({ id: raw.id, ...raw.data() });
      if (!parsed.success) {
        reportError(parsed.error, { action: 'getLatestVersion_parse', docId: documentId });
        return null;
      }
      return parsed.data as Version;
    } catch (e) {
      reportError(e, { action: 'getLatestVersion', userId, documentId });
      handleFirestoreError(e, OperationType.LIST, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },
};
