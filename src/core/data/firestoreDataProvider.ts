import { IDataProvider, ProviderRecord } from './types';
import { getClient } from '../firebase/firestoreClient';
import { handleFirestoreError, OperationType } from '../errors/firestore-errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FirestorePayload = Record<string, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTimestamps(data: ProviderRecord, mod: any): FirestorePayload {
  const payload = { ...data };
  const dateFields = ['savedAt', 'sessionStartedAt', 'updatedAt', 'firstSessionAt', 'lastSessionAt'];
  for (const field of dateFields) {
    const val = payload[field];
    if (val !== undefined && val !== null) {
      if (typeof val === 'number') {
        payload[field] = mod.Timestamp.fromMillis(val);
      } else if (val instanceof Date) {
        payload[field] = mod.Timestamp.fromDate(val);
      }
    }
  }
  return payload;
}

export const FirestoreDataProvider: IDataProvider = {
  // --- Document Operations ---
  async createDocument(userId: string, data: ProviderRecord): Promise<string> {
    try {
      const { db, mod } = await getClient();
      const { collection, addDoc } = mod;
      const payload = convertTimestamps(data, mod);
      const ref = await addDoc(collection(db, 'users', userId, 'documents'), payload);
      return ref.id;
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/documents`);
      throw e;
    }
  },

  async getDocument(userId: string, documentId: string): Promise<ProviderRecord | null> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', userId, 'documents', documentId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async getUserDocuments(userId: string): Promise<ProviderRecord[]> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs } = mod;
      const snap = await getDocs(collection(db, 'users', userId, 'documents'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/documents`);
      throw e;
    }
  },

  async updateDocument(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc } = mod;
      const payload = convertTimestamps(data, mod);
      await updateDoc(doc(db, 'users', userId, 'documents', documentId), payload);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async updateDocumentSessionStats(
    userId: string,
    documentId: string,
    stats: {
      totalWords: number;
      totalDuration: number;
      currentVersion: number;
      mood?: string | null;
      sessionsCount?: number;
      lastSessionAt?: Date;
    }
  ): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc, Timestamp, increment, deleteField } = mod;
      const updateData: Record<string, unknown> = {
        totalWords: stats.totalWords,
        totalDuration: stats.totalDuration,
        currentVersion: stats.currentVersion,
      };
      if (stats.mood) {
        updateData.mood = stats.mood;
      } else if (stats.mood === null) {
        updateData.mood = deleteField();
      }

      if (stats.sessionsCount !== undefined) {
        updateData.sessionsCount = stats.sessionsCount;
      } else {
        updateData.sessionsCount = increment(1);
      }

      if (stats.lastSessionAt !== undefined) {
        updateData.lastSessionAt = Timestamp.fromDate(stats.lastSessionAt);
      } else {
        updateData.lastSessionAt = Timestamp.now();
      }

      await updateDoc(doc(db, 'users', userId, 'documents', documentId), updateData as FirestorePayload);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, collection, getDocs, writeBatch, getDoc } = mod;
      const ref = doc(db, 'users', userId, 'documents', documentId);

      let localId: string | undefined;
      try {
        const docSnap = await getDoc(ref);
        if (docSnap.exists()) {
          const docData = docSnap.data() as Record<string, unknown>;
          if (typeof docData?.id === 'string') {
            localId = docData.id;
          }
        }
      } catch {
        // Fallback to deleting using cloud documentId if reading fails
      }

      const versionsSnap = await getDocs(collection(ref, 'versions'));
      const versionRefs = versionsSnap.docs.map(v => v.ref);
      for (let i = 0; i < versionRefs.length; i += 499) {
        const batch = writeBatch(db);
        versionRefs.slice(i, i + 499).forEach(r => batch.delete(r));
        await batch.commit();
      }
      const finalBatch = writeBatch(db);
      finalBatch.delete(ref);
      
      const targetId = localId || documentId;
      finalBatch.delete(doc(db, 'users', userId, 'summaries', targetId));
      finalBatch.delete(doc(db, 'users', userId, 'embeddings', targetId));
      await finalBatch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${userId}/documents/${documentId}`);
      throw e;
    }
  },

  async clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { collection, query, where, getDocs, writeBatch } = mod;
      const docsRef = collection(db, 'users', userId, 'documents');
      const q = query(docsRef, where('labelId', '==', labelId));
      const querySnapshot = await getDocs(q);

      let batch = writeBatch(db);
      let count = 0;
      for (const d of querySnapshot.docs) {
        batch.update(d.ref, { labelId: null });
        count++;
        if (count === 499) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) {
        await batch.commit();
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents`);
      throw e;
    }
  },

  async renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { collection, query, where, getDocs, writeBatch } = mod;
      const docsRef = collection(db, 'users', userId, 'documents');
      const q = query(docsRef, where('tags', 'array-contains', oldTag));
      const querySnapshot = await getDocs(q);

      let batch = writeBatch(db);
      let count = 0;

      for (const d of querySnapshot.docs) {
        const data = d.data();
        const tags = (data.tags || []) as string[];
        const newTags = Array.from(new Set(tags.map(t => (t === oldTag ? newTag : t))));
        batch.update(d.ref, { tags: newTags });
        count++;
        if (count === 499) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents`);
      throw e;
    }
  },

  async removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { collection, query, where, getDocs, writeBatch, arrayRemove } = mod;
      const docsRef = collection(db, 'users', userId, 'documents');
      const q = query(docsRef, where('tags', 'array-contains', tag));
      const querySnapshot = await getDocs(q);

      let batch = writeBatch(db);
      let count = 0;

      for (const d of querySnapshot.docs) {
        batch.update(d.ref, { tags: arrayRemove(tag) });
        count++;
        if (count === 499) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents`);
      throw e;
    }
  },

  // --- Version Operations ---
  async addVersion(userId: string, documentId: string, versionId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      const payload = convertTimestamps(data, mod);
      await setDoc(doc(db, 'users', userId, 'documents', documentId, 'versions', versionId), payload, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/documents/${documentId}/versions/${versionId}`);
      throw e;
    }
  },

  async getVersions(userId: string, documentId: string): Promise<ProviderRecord[]> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs } = mod;
      const snap = await getDocs(collection(db, 'users', userId, 'documents', documentId, 'versions'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },

  async getLatestVersion(userId: string, documentId: string): Promise<ProviderRecord | null> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs, query, orderBy, limit } = mod;
      const q = query(
        collection(db, 'users', userId, 'documents', documentId, 'versions'),
        orderBy('version', 'desc'),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const firstDoc = snap.docs[0];
      return firstDoc ? { id: firstDoc.id, ...firstDoc.data() } : null;
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/documents/${documentId}/versions`);
      throw e;
    }
  },

  async updateVersion(userId: string, documentId: string, versionId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc } = mod;
      const payload = convertTimestamps(data, mod);
      await updateDoc(doc(db, 'users', userId, 'documents', documentId, 'versions', versionId), payload);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}/versions/${versionId}`);
      throw e;
    }
  },

  async updateVersionsBatch(userId: string, documentId: string, updates: { versionId: string; data: ProviderRecord }[]): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, writeBatch } = mod;
      
      let batch = writeBatch(db);
      let count = 0;

      for (const update of updates) {
        const ref = doc(db, 'users', userId, 'documents', documentId, 'versions', update.versionId);
        batch.update(ref, convertTimestamps(update.data, mod));
        count++;
        if (count === 499) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}/documents/${documentId}/versions (batch)`);
      throw e;
    }
  },

  async deleteVersionsBatch(userId: string, documentId: string, versionIds: string[]): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, writeBatch } = mod;
      
      let batch = writeBatch(db);
      let count = 0;

      for (const versionId of versionIds) {
        const ref = doc(db, 'users', userId, 'documents', documentId, 'versions', versionId);
        batch.delete(ref);
        count++;
        if (count === 499) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${userId}/documents/${documentId}/versions (batch)`);
      throw e;
    }
  },

  // --- Profile & Admin Operations ---
  async getProfile(userId: string): Promise<ProviderRecord | null> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', userId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}`);
      throw e;
    }
  },

  async updateProfile(userId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      await setDoc(doc(db, 'users', userId), data, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${userId}`);
      throw e;
    }
  },

  subscribeToProfile(userId: string, onUpdate: (data: ProviderRecord | null) => void): () => void {
    let unsubscribe = () => {};
    
    // We cannot use await getClient() directly in a synchronous return pattern.
    // The typical pattern is to fetch the client asynchronously inside the subscribe method
    // and store the true unsubscribe function.
    let isUnsubscribed = false;
    
    getClient().then(({ db, mod }) => {
      if (isUnsubscribed) return;
      const { doc, onSnapshot } = mod;
      const trueUnsubscribe = onSnapshot(doc(db, 'users', userId), (snap) => {
        if (!snap.exists()) {
          onUpdate(null);
        } else {
          onUpdate({ id: snap.id, ...snap.data() });
        }
      }, (err) => {
        handleFirestoreError(err, OperationType.GET, `users/${userId}`);
      });
      
      unsubscribe = trueUnsubscribe;
    }).catch(err => {
      // Failed to get client
      handleFirestoreError(err, OperationType.GET, `users/${userId}`);
    });

    return () => {
      isUnsubscribed = true;
      unsubscribe();
    };
  },

  async getUsers(limitCount: number): Promise<ProviderRecord[]> {
    try {
      const { db, mod } = await getClient();
      const { collection, query, limit, getDocs } = mod;
      const q = query(
        collection(db, 'users'),
        limit(limitCount)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users`);
      throw e;
    }
  },

  // --- Writing Draft Operations ---
  async getDraft(userId: string): Promise<ProviderRecord | null> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'drafts', userId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `drafts/${userId}`);
      throw e;
    }
  },

  async saveDraft(userId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc, serverTimestamp } = mod;
      const payload = convertTimestamps(data, mod);
      await setDoc(doc(db, 'drafts', userId), { ...payload, updatedAt: serverTimestamp() } as FirestorePayload);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `drafts/${userId}`);
      throw e;
    }
  },

  async updateDraft(userId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc } = mod;
      const payload = convertTimestamps(data, mod);
      await updateDoc(doc(db, 'drafts', userId), payload);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `drafts/${userId}`);
      throw e;
    }
  },

  async deleteDraft(userId: string): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, deleteDoc } = mod;
      await deleteDoc(doc(db, 'drafts', userId));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `drafts/${userId}`);
      throw e;
    }
  },

  // --- AI Summary Operations ---
  async getSummary(userId: string, documentId: string): Promise<ProviderRecord | null> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', userId, 'summaries', documentId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/summaries/${documentId}`);
      throw e;
    }
  },

  async saveSummary(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      await setDoc(doc(db, 'users', userId, 'summaries', documentId), data as FirestorePayload, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/summaries/${documentId}`);
      throw e;
    }
  },

  async getUserSummaries(userId: string): Promise<ProviderRecord[]> {
    try {
      const { db, mod } = await getClient();
      const { collection, getDocs } = mod;
      const snap = await getDocs(collection(db, 'users', userId, 'summaries'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/summaries`);
      throw e;
    }
  },

  // --- AI Embedding Operations ---
  async getEmbedding(userId: string, documentId: string): Promise<ProviderRecord | null> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', userId, 'embeddings', documentId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/embeddings/${documentId}`);
      throw e;
    }
  },

  async saveEmbedding(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      await setDoc(doc(db, 'users', userId, 'embeddings', documentId), data as FirestorePayload, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}/embeddings/${documentId}`);
      throw e;
    }
  },

  async getUserEmbeddingsPaginated(userId: string, limitCount: number, cursorId?: string): Promise<{ items: ProviderRecord[]; nextCursorId?: string; readCount: number }> {
    try {
      const { db, mod } = await getClient();
      const { collection, query, orderBy, startAfter, limit, getDocs, doc, getDoc } = mod;
      const col = collection(db, 'users', userId, 'embeddings');
      let q;
      
      if (cursorId) {
        const cursorDoc = await getDoc(doc(db, 'users', userId, 'embeddings', cursorId));
        if (cursorDoc.exists()) {
          q = query(col, orderBy('__name__'), startAfter(cursorDoc), limit(limitCount));
        } else {
          q = query(col, orderBy('__name__'), limit(limitCount));
        }
      } else {
        q = query(col, orderBy('__name__'), limit(limitCount));
      }
      
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nextCursorId = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1]?.id : undefined;
      return { items, ...(nextCursorId ? { nextCursorId } : {}), readCount: snap.docs.length };
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/embeddings`);
      throw e;
    }
  },

  async getEmbeddingsPage(userId: string, limitCount: number, startAfterId?: string): Promise<ProviderRecord[]> {
    try {
      const { db, mod } = await getClient();
      const { collection, query, limit, getDocs, orderBy, startAfter } = mod;
      
      let q = query(
        collection(db, 'users', userId, 'embeddings'),
        orderBy('documentId'),
        limit(limitCount)
      );

      if (startAfterId) {
        // Find the cursor doc
        const { doc, getDoc } = mod;
        const cursorDoc = await getDoc(doc(db, 'users', userId, 'embeddings', startAfterId));
        if (cursorDoc.exists()) {
          q = query(q, startAfter(cursorDoc));
        }
      }

      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}/embeddings`);
      throw e;
    }
  },

  // --- AI Profile & Restore Operations ---
  async getAIProfile(userId: string): Promise<ProviderRecord | null> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', userId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}`);
      throw e;
    }
  },

  async saveAIProfile(userId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      await setDoc(doc(db, 'users', userId), data, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}`);
      throw e;
    }
  },

  // --- Encryption Meta & Legacy Keys ---
  async getEncryptionMeta(userId: string): Promise<ProviderRecord | null> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', userId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}`);
      throw e;
    }
  },

  async saveEncryptionMeta(userId: string, data: ProviderRecord): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc, deleteField } = mod;
      await setDoc(doc(db, 'users', userId), {
        ...data,
        encryptionSalt: deleteField(),
        encryptedDataKey: deleteField(),
      }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${userId}`);
      throw e;
    }
  },

  async hasLegacyKey(userId: string): Promise<boolean> {
    try {
      const { db, mod } = await getClient();
      const { doc, getDoc } = mod;
      const snap = await getDoc(doc(db, 'users', userId));
      if (!snap.exists()) return false;
      const data = snap.data();
      return !!data.encryptedMasterKey && !data.mKeyVersion;
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${userId}`);
      return false;
    }
  },

  // --- Sync Operations ---
  async applySyncChanges(userId: string, changes: {
    docsToUpdate: Array<{ id: string; data: ProviderRecord }>;
    docsToDelete: string[];
    versionsToUpdate: Array<{ documentId: string; versionId: string; data: ProviderRecord }>;
  }): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { doc, writeBatch } = mod;
      
      let batch = writeBatch(db);
      let count = 0;

      const commitIfNeeded = async () => {
        if (count === 499) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      };

      for (const update of changes.docsToUpdate) {
        batch.set(doc(db, 'users', userId, 'documents', update.id), convertTimestamps(update.data, mod), { merge: true });
        count++;
        await commitIfNeeded();
      }

      for (const delId of changes.docsToDelete) {
        batch.delete(doc(db, 'users', userId, 'documents', delId));
        count++;
        await commitIfNeeded();
      }

      for (const update of changes.versionsToUpdate) {
        batch.set(doc(db, 'users', userId, 'documents', update.documentId, 'versions', update.versionId), convertTimestamps(update.data, mod), { merge: true });
        count++;
        await commitIfNeeded();
      }

      if (count > 0) {
        await batch.commit();
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${userId} (sync batch)`);
      throw e;
    }
  },

  // --- Migration ---
  async getMigrationDrafts(userId: string): Promise<{ id: string; data: ProviderRecord }[]> {
    try {
      const { db, mod } = await getClient();
      const { collection, query, where, getDocs } = mod;
      const snap = await getDocs(query(collection(db, 'drafts'), where('userId', '==', userId)));
      return snap.docs.map(d => ({ id: d.id, data: d.data() }));
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, 'drafts');
      throw e;
    }
  },

  async executeMigrationBatch(ops: {
    type: 'version' | 'draft';
    userId: string;
    documentId?: string;
    versionId?: string;
    draftId?: string;
    data: ProviderRecord;
  }[]): Promise<void> {
    try {
      const { db, mod } = await getClient();
      const { writeBatch, doc } = mod;
      const batch = writeBatch(db);
      for (const op of ops) {
        if (op.type === 'version' && op.documentId && op.versionId) {
          batch.set(doc(db, 'users', op.userId, 'documents', op.documentId, 'versions', op.versionId), convertTimestamps(op.data, mod), { merge: true });
        } else if (op.type === 'draft' && op.draftId) {
          batch.set(doc(db, 'drafts', op.draftId), convertTimestamps(op.data, mod), { merge: true });
        }
      }
      await batch.commit();
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'migration_batch');
      throw e;
    }
  }
};
