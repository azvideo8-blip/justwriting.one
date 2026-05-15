import { getDb } from '../../../core/firebase/firestore';
import { Version } from '../../../types';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { computeWordDelta } from './DiffService';

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
    }
  ): Promise<string> {
    const payloadSize = new Blob([data.content]).size;
    if (payloadSize > 900_000) {
      throw new Error(`Content too large (${(payloadSize / 1024).toFixed(0)}KB). Firestore limit is 1MB per document.`);
    }
    try {
      const [{ collection, addDoc, Timestamp }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      const diff = computeWordDelta(data.previousContent, data.content);
      const ref = await addDoc(collection(db, 'users', userId, 'documents', documentId, 'versions'), {
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
      });
      return ref.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },

  async getVersions(userId: string, documentId: string): Promise<Version[]> {
    try {
      const [{ collection, getDocs }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      const snap = await getDocs(collection(db, 'users', userId, 'documents', documentId, 'versions'));
      const versions = snap.docs.map(d => ({ id: d.id, ...d.data() } as Version));
      versions.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
      return versions;
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },

  async getLatestContent(userId: string, documentId: string): Promise<string> {
    try {
      const [{ collection, getDocs, query, orderBy, limit }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      const q = query(collection(db, 'users', userId, 'documents', documentId, 'versions'), orderBy('version', 'desc'), limit(1));
      const snap = await getDocs(q);
      if (snap.docs.length === 0) return '';
      return (snap.docs[0].data() as Version).content || '';
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, `users/${userId}/documents/${documentId}/versions`);
      return '';
    }
  },
};
