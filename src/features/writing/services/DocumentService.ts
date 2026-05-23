import { getClient } from '../../../core/firebase/firestoreClient';
import { Document } from '../../../types';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { toTimestampMs } from '../../../core/utils/dateUtils';
import { reportError } from '../../../core/errors/reportError';
import { documentDbSchema } from '../../../shared/schemas/firestoreSchemas';

export const DocumentService = {
  async createDocument(
    userId: string,
    data: Pick<Document, 'title' | 'tags' | 'labelId'> & {
      firstSessionAt?: Date;
      lastSessionAt?: Date;
    }
  ): Promise<string> {
    try {
      const { db, mod } = await getClient();
      const { collection, addDoc, Timestamp } = mod;
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
      reportError(e, { action: 'createDocument', userId });
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/documents`);
      throw e;
    }
  },

  async getDocument(userId: string, documentId: string): Promise<Document | null> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', userId, 'documents', documentId));
      if (!snap.exists()) return null;
      const parsed = documentDbSchema.safeParse({ id: snap.id, ...snap.data() });
      if (!parsed.success) {
        reportError(parsed.error, { action: 'getDocument_parse', docId: documentId });
        return null;
      }
      return parsed.data as Document;
    } catch (e) {
      reportError(e, { action: 'getDocument', userId, documentId });
      handleFirestoreError(e, OperationType.GET, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async getUserDocuments(userId: string): Promise<Document[]> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs } = mod;
      const snap = await getDocs(collection(db, 'users', userId, 'documents'));
      const docs = snap.docs
        .map(d => {
          const parsed = documentDbSchema.safeParse({ id: d.id, ...d.data() });
          if (!parsed.success) {
            reportError(parsed.error, { action: 'getUserDocuments_parse', docId: d.id });
            return null;
          }
          return parsed.data as Document;
        })
        .filter((d): d is Document => d !== null);
      docs.sort((a, b) => (toTimestampMs(b.lastSessionAt) ?? 0) - (toTimestampMs(a.lastSessionAt) ?? 0));
      return docs;
    } catch (e) {
      reportError(e, { action: 'getUserDocuments', userId });
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
      const { db, mod } = await getClient();
      const { doc, updateDoc, Timestamp, increment } = mod;
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), {
        ...data,
        sessionsCount: increment(1),
        lastSessionAt: Timestamp.now(),
      });
    } catch (e) {
      reportError(e, { action: 'updateDocumentAfterSession', userId, documentId });
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateTags(userId: string, documentId: string, tags: string[]): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc } = mod;
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), { tags });
    } catch (e) {
      reportError(e, { action: 'updateTags', userId, documentId });
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateTitle(userId: string, documentId: string, title: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc } = mod;
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), { title });
    } catch (e) {
      reportError(e, { action: 'updateTitle', userId, documentId });
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateDate(userId: string, documentId: string, firstSessionAt: Date, lastSessionAt: Date): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc, Timestamp } = mod;
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), {
        firstSessionAt: Timestamp.fromDate(firstSessionAt),
        lastSessionAt: Timestamp.fromDate(lastSessionAt),
      });
    } catch (e) {
      reportError(e, { action: 'updateDate', userId, documentId });
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateLabelId(userId: string, documentId: string, labelId: string | undefined): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc } = mod;
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), { labelId: labelId ?? null });
    } catch (e) {
      reportError(e, { action: 'updateLabelId', userId, documentId });
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, collection, getDocs, writeBatch } = mod;
      const ref = doc(db, 'users', userId, 'documents', documentId);
      const versionsSnap = await getDocs(collection(ref, 'versions'));
      const versionRefs = versionsSnap.docs.map(v => v.ref);
      for (let i = 0; i < versionRefs.length; i += 499) {
        const batch = writeBatch(db);
        versionRefs.slice(i, i + 499).forEach(r => batch.delete(r));
        await batch.commit();
      }
      const finalBatch = writeBatch(db);
      finalBatch.delete(ref);
      await finalBatch.commit();
    } catch (e) {
      reportError(e, { action: 'deleteDocument', userId, documentId });
      handleFirestoreError(e, OperationType.DELETE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs, writeBatch, query, where } = mod;
      const q = query(collection(db, 'users', userId, 'documents'), where('labelId', '==', labelId));
      const snap = await getDocs(q);
      const matching = snap.docs;
      for (let i = 0; i < matching.length; i += 499) {
        const batch = writeBatch(db);
        matching.slice(i, i + 499).forEach(d => batch.update(d.ref, { labelId: null }));
        await batch.commit();
      }
    } catch (e) {
      reportError(e, { action: 'clearLabelFromAllDocs', userId, labelId });
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents`);
    }
  },

  async renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs, writeBatch, query, where } = mod;
      const q = query(collection(db, 'users', userId, 'documents'), where('tags', 'array-contains', oldTag));
      const snap = await getDocs(q);
      const matching = snap.docs;
      for (let i = 0; i < matching.length; i += 499) {
        const batch = writeBatch(db);
        matching.slice(i, i + 499).forEach(d => {
          const tags: string[] = d.data().tags ?? [];
          batch.update(d.ref, { tags: tags.map(t => t === oldTag ? newTag : t) });
        });
        await batch.commit();
      }
    } catch (e) {
      reportError(e, { action: 'renameTagInAllDocs', userId });
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents`);
    }
  },

  async removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs, writeBatch, query, where } = mod;
      const q = query(collection(db, 'users', userId, 'documents'), where('tags', 'array-contains', tag));
      const snap = await getDocs(q);
      const matching = snap.docs;
      for (let i = 0; i < matching.length; i += 499) {
        const batch = writeBatch(db);
        matching.slice(i, i + 499).forEach(d => {
          const tags: string[] = d.data().tags ?? [];
          batch.update(d.ref, { tags: tags.filter(t => t !== tag) });
        });
        await batch.commit();
      }
    } catch (e) {
      reportError(e, { action: 'removeTagFromAllDocs', userId });
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents`);
    }
  },
};
