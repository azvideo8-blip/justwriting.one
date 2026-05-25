import { getClient } from '../firebase/firestoreClient';
import { handleFirestoreError, OperationType } from '../errors/firestore-errors';
import { Session } from '../../types';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { reportError } from '../errors/reportError';
import { sessionDbSchema } from '../firebase/schemas/firestoreSchemas';

export const SessionService = {
  async saveSession(session: Session) {
    try {
      const { db, mod } = await getClient();
      const { doc, setDoc } = mod;
      const clean = Object.fromEntries(Object.entries(session).filter(([, v]) => v !== undefined));
      await setDoc(doc(db, 'sessions', session.id), clean);
    } catch (err) {
      // [A-04] дублирующий reportError убран: handleFirestoreError уже логирует внутри
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
      // [A-04] дублирующий reportError убран
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
      // [A-04] дублирующий reportError убран
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
      // [A-04] дублирующий reportError убран
      handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
      throw err;
    }
  },

  async getAllSessions(userId: string, limitCount: number = 20, lastDoc?: QueryDocumentSnapshot<DocumentData>) {
    try {
      const { db, mod } = await getClient();
      const { query, where, collection, limit, getDocs, startAfter, orderBy } = mod;
      let q = query(
        collection(db, 'sessions'), 
        where('userId', '==', userId), 
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      if (lastDoc) q = query(q, startAfter(lastDoc));

      const snap = await getDocs(q);
      // [L-06] клиентская сортировка убрана: Firestore orderBy('createdAt', 'desc') уже гарантирует порядок
      const sessions = snap.docs
        .map(d => {
          const parsed = sessionDbSchema.safeParse({ id: d.id, ...d.data() });
          if (!parsed.success) {
            reportError(parsed.error, { action: 'getAllSessions_parse', docId: d.id });
            return null;
          }
          return parsed.data as Session;
        })
        .filter((s): s is Session => s !== null);
      const newLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot<DocumentData> : null;
      return { sessions, lastDoc: newLastDoc, error: false };
    } catch (err) {
      reportError(err, { action: 'getAllSessions', userId });
      return { sessions: [], lastDoc: null, error: true };
    }
  },

  async getAllSessionsAdmin(limitCount: number = 50, lastDoc?: QueryDocumentSnapshot<DocumentData>) {
    try {
      const { db, mod } = await getClient();
      const { query, collection, limit, getDocs, startAfter, orderBy } = mod;
      let q = query(
        collection(db, 'sessions'), 
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
      if (lastDoc) q = query(q, startAfter(lastDoc));
      
      const snap = await getDocs(q);
      const sessions = snap.docs
        .map(d => {
          const parsed = sessionDbSchema.safeParse({ id: d.id, ...d.data() });
          if (!parsed.success) {
            reportError(parsed.error, { action: 'getAllSessionsAdmin_parse', docId: d.id });
            return null;
          }
          return parsed.data as Session;
        })
        .filter((s): s is Session => s !== null);
      const newLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot<DocumentData> : null;
      return { sessions, lastDoc: newLastDoc, error: false };
    } catch (err) {
      reportError(err, { action: 'getAllSessionsAdmin' });
      return { sessions: [], lastDoc: null, error: true };
    }
  },
};
