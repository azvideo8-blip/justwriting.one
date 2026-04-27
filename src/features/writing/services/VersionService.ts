import { collection, addDoc, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { Version } from '../../../types';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { computeWordDiff } from './DiffService';

const versionsRef = (userId: string, documentId: string) =>
  collection(db, 'users', userId, 'documents', documentId, 'versions');

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
    try {
      const diff = computeWordDiff(data.previousContent, data.content);
      const ref = await addDoc(versionsRef(userId, documentId), {
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
      const q = query(
        versionsRef(userId, documentId),
        orderBy('version', 'asc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as Version));
    } catch (e) {
      handleFirestoreError(e, OperationType.LIST, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },
};
