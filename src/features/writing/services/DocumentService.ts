import { getDb } from '../../../core/firebase/firestore';
import { Document } from '../../../types';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { toTimestampMs } from '../../../core/utils/dateUtils';

export const DocumentService = {
  async createDocument(
    userId: string,
    data: Pick<Document, 'title' | 'tags' | 'labelId'> & {
      firstSessionAt?: Date;
      lastSessionAt?: Date;
    }
  ): Promise<string> {
    try {
      const [{ collection, addDoc, Timestamp }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      const now = Timestamp.now();
      const ref = await addDoc(collection(db, 'users', userId, 'documents'), {
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
      const [{ doc, getDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      const snap = await getDoc(doc(db, 'users', userId, 'documents', documentId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as Document;
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async getUserDocuments(userId: string): Promise<Document[]> {
    try {
      const [{ collection, getDocs }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      const snap = await getDocs(collection(db, 'users', userId, 'documents'));
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
      const [{ doc, updateDoc, Timestamp, increment }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), {
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
      const [{ doc, updateDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), { tags });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateTitle(userId: string, documentId: string, title: string): Promise<void> {
    try {
      const [{ doc, updateDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), { title });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateDate(userId: string, documentId: string, firstSessionAt: Date, lastSessionAt: Date): Promise<void> {
    try {
      const [{ doc, updateDoc, Timestamp }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), {
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
      const [{ doc, updateDoc }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), { labelId: labelId ?? null });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    try {
      const [{ doc, collection, getDocs, writeBatch }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
      const ref = doc(db, 'users', userId, 'documents', documentId);
      const versionsSnap = await getDocs(collection(ref, 'versions'));
      const batch = writeBatch(db);
      versionsSnap.forEach(v => batch.delete(v.ref));
      batch.delete(ref);
      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
    const [{ collection, getDocs, writeBatch }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
    const snap = await getDocs(collection(db, 'users', userId, 'documents'));
    const matching = snap.docs.filter(d => d.data().labelId === labelId);
    for (let i = 0; i < matching.length; i += 499) {
      const batch = writeBatch(db);
      matching.slice(i, i + 499).forEach(d => batch.update(d.ref, { labelId: null }));
      await batch.commit();
    }
  },

  async renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
    const [{ collection, getDocs, writeBatch }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
    const snap = await getDocs(collection(db, 'users', userId, 'documents'));
    const matching = snap.docs.filter(d => (d.data().tags ?? []).includes(oldTag));
    for (let i = 0; i < matching.length; i += 499) {
      const batch = writeBatch(db);
      matching.slice(i, i + 499).forEach(d => {
        const tags: string[] = d.data().tags ?? [];
        batch.update(d.ref, { tags: tags.map(t => t === oldTag ? newTag : t) });
      });
      await batch.commit();
    }
  },

  async removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
    const [{ collection, getDocs, writeBatch }, db] = await Promise.all([import('firebase/firestore'), getDb()]);
    const snap = await getDocs(collection(db, 'users', userId, 'documents'));
    const matching = snap.docs.filter(d => (d.data().tags ?? []).includes(tag));
    for (let i = 0; i < matching.length; i += 499) {
      const batch = writeBatch(db);
      matching.slice(i, i + 499).forEach(d => {
        const tags: string[] = d.data().tags ?? [];
        batch.update(d.ref, { tags: tags.filter(t => t !== tag) });
      });
      await batch.commit();
    }
  },
};
