import { doc, updateDoc, deleteDoc, setDoc, onSnapshot, query, where, collection, limit, getDocs, orderBy, startAfter, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { Session } from '../../../types';
import { parseFirestoreDate } from '../../../core/utils/utils';

export const SessionService = {
  async saveSession(session: Session) {
    try {
      await setDoc(doc(db, 'sessions', session.id), session);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `sessions/${session.id}`);
    }
  },

  async deleteSession(sessionId: string) {
    try {
      if (import.meta.env.DEV) {
        console.warn('SessionService: Attempting to delete session', sessionId);
      }
      await deleteDoc(doc(db, 'sessions', sessionId));
      if (import.meta.env.DEV) {
        console.warn('SessionService: Session deleted successfully', sessionId);
      }
    } catch (err) {
      console.error('SessionService: Error deleting session', sessionId, err);
      handleFirestoreError(err, OperationType.DELETE, `sessions/${sessionId}`);
    }
  },

  subscribeToSessions(userId: string, callback: (sessions: Session[]) => void, onError: (err: Error) => void) {
    const q = query(collection(db, 'sessions'), where('userId', '==', userId), orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      callback(docs);
    }, onError);
  },

  async updateSessionTags(sessionId: string, tags: string[]) {
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { tags });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
    }
  },

  async updateSession(sessionId: string, data: Partial<Session>) {
    try {
      await updateDoc(doc(db, 'sessions', sessionId), data);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
    }
  },

  async getAllSessions(userId: string, limitCount: number = 20, lastDoc?: QueryDocumentSnapshot<DocumentData>) {
    try {
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
      console.error('SessionService.getAllSessions failed:', err);
      return { sessions: [], lastDoc: null };
    }
  },

  async getAllSessionsAdmin(limitCount: number = 50, lastDoc?: QueryDocumentSnapshot<DocumentData>) {
    try {
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
      console.error('SessionService.getAllSessionsAdmin failed:', err);
      return { sessions: [], lastDoc: null };
    }
  },
};
