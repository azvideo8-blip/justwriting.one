import { getClient } from '../../../core/firebase/firestoreClient';
import { Version } from '../../../types';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { computeWordDelta } from './DiffService';
import { reportError } from '../../../core/errors/reportError';

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
      goalWords?: number;
      goalTime?: number;
      goalReached?: boolean;
      sessionStartedAt: Date;
      _encrypted?: boolean;
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
        savedAt: Timestamp.now(),
        sessionStartedAt: Timestamp.fromDate(data.sessionStartedAt),
      };
      if (data._encrypted) doc._encrypted = true;
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
      const versions = snap.docs.map(d => ({ id: d.id, ...d.data() } as Version));
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
      return (snap.docs[0].data() as Version).content || '';
    } catch (e) {
      reportError(e, { action: 'getLatestContent', userId, documentId });
      handleFirestoreError(e, OperationType.LIST, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },
};
