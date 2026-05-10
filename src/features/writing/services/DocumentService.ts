import { collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, Timestamp, increment } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { Document } from '../../../types';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { toTimestampMs } from '../../../core/utils/dateUtils';

const documentsRef = (userId: string) =>
  collection(db, 'users', userId, 'documents');

const documentRef = (userId: string, documentId: string) =>
  doc(db, 'users', userId, 'documents', documentId);

export const DocumentService = {
  async createDocument(
    userId: string,
    data: Pick<Document, 'title' | 'tags' | 'labelId'> & {
      firstSessionAt?: Date;
      lastSessionAt?: Date;
    }
  ): Promise<string> {
    try {
      const now = Timestamp.now();
      const ref = await addDoc(documentsRef(userId), {
        userId,
        title: data.title,
        currentVersion: 0,
        totalWords: 0,
        totalDuration: 0,
        sessionsCount: 0,
        firstSessionAt: data.firstSessionAt ? Timestamp.fromDate(data.firstSessionAt) : now,
        lastSessionAt: data.lastSessionAt ? Timestamp.fromDate(data.lastSessionAt) : now,
        tags: data.tags ?? [],
        labelId: data.labelId ?? null,
      });
      return ref.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/documents`);
      throw e;
    }
  },

  async getDocument(userId: string, documentId: string): Promise<Document | null> {
    try {
      const snap = await getDoc(documentRef(userId, documentId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as Document;
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async getUserDocuments(userId: string): Promise<Document[]> {
    try {
      const snap = await getDocs(documentsRef(userId));
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Document));
      docs.sort((a, b) => (toTimestampMs(b.lastSessionAt) ?? 0) - (toTimestampMs(a.lastSessionAt) ?? 0));
      return docs;
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/documents`);
      throw e;
    }
  },

  async updateDocumentAfterSession(
    userId: string,
    documentId: string,
    data: {
      totalWords: number;
      totalDuration: number;
      currentVersion: number;
    }
  ): Promise<void> {
    try {
      await updateDoc(documentRef(userId, documentId), {
        ...data,
        sessionsCount: increment(1),
        lastSessionAt: Timestamp.now(),
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateTags(userId: string, documentId: string, tags: string[]): Promise<void> {
    try {
      await updateDoc(documentRef(userId, documentId), { tags });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateTitle(userId: string, documentId: string, title: string): Promise<void> {
    try {
      await updateDoc(documentRef(userId, documentId), { title });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateDate(userId: string, documentId: string, firstSessionAt: Date, lastSessionAt: Date): Promise<void> {
    try {
      await updateDoc(documentRef(userId, documentId), {
        firstSessionAt: Timestamp.fromDate(firstSessionAt),
        lastSessionAt: Timestamp.fromDate(lastSessionAt),
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateLabelId(userId: string, documentId: string, labelId: string | undefined): Promise<void> {
    try {
      await updateDoc(documentRef(userId, documentId), { labelId: labelId ?? null });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    try {
      await deleteDoc(documentRef(userId, documentId));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },
};
