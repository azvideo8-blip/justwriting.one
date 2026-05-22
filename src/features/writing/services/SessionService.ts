import { getClient } from '../../../core/firebase/firestoreClient';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { Session } from '../../../types';
import { parseFirestoreDate } from '../../../core/utils/utils';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { reportError } from '../../../core/errors/reportError';

export const SessionService = {
  async saveSession(session: Session) {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      const clean = Object.fromEntries(Object.entries(session).filter(([, v]) => v !== undefined));
      await setDoc(doc(db, 'sessions', session.id), clean);
    } catch (err) {
      reportError(err, { action: 'saveSession', sessionId: session.id });
      handleFirestoreError(err, OperationType.WRITE, `sessions/${session.id}`);
      throw err;
    }
  },

  async deleteSession(sessionId: string) {
    try {
      const { db, mod } = await getClient();
      const { doc, deleteDoc } = mod;
      if (import.meta.env.DEV) {
        console.warn('SessionService: Attempting to delete session', sessionId);
      }
      await deleteDoc(doc(db, 'sessions', sessionId));
      if (import.meta.env.DEV) {
        console.warn('SessionService: Session deleted successfully', sessionId);
      }
    } catch (err) {
      reportError(err, { action: 'deleteSession', sessionId });
      handleFirestoreError(err, OperationType.DELETE, `sessions/${sessionId}`);
      throw err;
    }
  },

  async updateSessionTags(sessionId: string, tags: string[]) {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc, serverTimestamp } = mod;
      await updateDoc(doc(db, 'sessions', sessionId), { tags, _updatedAt: serverTimestamp() });
    } catch (err) {
      reportError(err, { action: 'updateSessionTags', sessionId });
      handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
      throw err;
    }
  },

  async updateSession(sessionId: string, data: Partial<Session>) {
    try {
      const { db, mod } = await getClient();
      const { doc, updateDoc, serverTimestamp } = mod;
      const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      await updateDoc(doc(db, 'sessions', sessionId), { ...clean, _updatedAt: serverTimestamp() });
    } catch (err) {
      reportError(err, { action: 'updateSession', sessionId });
      handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
      throw err;
    }
  },

  async getAllSessions(userId: string, limitCount: number = 20, lastDoc?: QueryDocumentSnapshot<DocumentData>) {
    try {
      const { db, mod } = await getClient();
      const { query, where, collection, limit, getDocs, startAfter } = mod;
      let q = query(
        collection(db, 'sessions'), 
        where('userId', '==', userId), 
        limit(limitCount)
      );
      if (lastDoc) q = query(q, startAfter(lastDoc));

      const snap = await getDocs(q);
      const sessions = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Session))
        .sort((a, b) => {
          const ta = parseFirestoreDate(a.createdAt)?.getTime() ?? 0;
          const tb = parseFirestoreDate(b.createdAt)?.getTime() ?? 0;
          return tb - ta;
        });
      const newLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot<DocumentData> : null;
      return { sessions, lastDoc: newLastDoc };
    } catch (err) {
      reportError(err, { action: 'getAllSessions', userId });
      return { sessions: [], lastDoc: null };
    }
  },

  async getAllSessionsAdmin(limitCount: number = 50, lastDoc?: QueryDocumentSnapshot<DocumentData>) {
    try {
      const { db, mod } = await getClient();
      const { query, collection, limit, getDocs, startAfter } = mod;
      let q = query(collection(db, 'sessions'), limit(limitCount));
      if (lastDoc) q = query(q, startAfter(lastDoc));
      
      const snap = await getDocs(q);
      const sessions = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Session))
        .sort((a, b) => {
          const ta = parseFirestoreDate(a.createdAt)?.getTime() ?? 0;
          const tb = parseFirestoreDate(b.createdAt)?.getTime() ?? 0;
          return tb - ta;
        });
      const newLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot<DocumentData> : null;
      return { sessions, lastDoc: newLastDoc };
    } catch (err) {
      reportError(err, { action: 'getAllSessionsAdmin' });
      return { sessions: [], lastDoc: null };
    }
  },
};
