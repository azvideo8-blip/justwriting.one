import { collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { Document } from '../../../types';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';

const documentsRef = (userId: string) =>
  collection(db, 'users', userId, 'documents');

const documentRef = (userId: string, documentId: string) =>
  doc(db, 'users', userId, 'documents', documentId);

function toTimestamp(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && 'toDate' in (v as object)) return (v as { toDate: () => Date }).toDate().getTime();
  return 0;
}

export const DocumentService = {
  async createDocument(
    userId: string,
    data: Pick<Document, 'title' | 'isPublic' | 'tags' | 'labelId'>
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
        firstSessionAt: now,
        lastSessionAt: now,
        isPublic: data.isPublic ?? false,
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
      docs.sort((a, b) => toTimestamp(b.lastSessionAt) - toTimestamp(a.lastSessionAt));
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
        sessionsCount: data.currentVersion,
        lastSessionAt: Timestamp.now(),
      });
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
