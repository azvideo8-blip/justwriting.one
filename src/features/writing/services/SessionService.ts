import { doc, updateDoc, deleteDoc, setDoc, onSnapshot, query, where, collection, orderBy, limit, getDocs, startAfter, QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { Session } from '../../../types';

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

  async getAllSessions(userId: string, limitCount: number = 20, _lastDoc?: QueryDocumentSnapshot<DocumentData>) {
    try {
      const q = query(
        collection(db, 'sessions'), 
        where('userId', '==', userId), 
        limit(limitCount)
      );

      const snap = await getDocs(q);
      const sessions = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Session))
        .sort((a, b) => {
          const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return tb - ta;
        });
      return { sessions, lastDoc: null };
    } catch (err) {
      console.error('SessionService.getAllSessions failed:', err);
      return { sessions: [], lastDoc: null };
    }
  },

  async getAllSessionsAdmin(limitCount: number = 50, _lastDoc?: QueryDocumentSnapshot<DocumentData>) {
    try {
      const q = query(collection(db, 'sessions'), limit(limitCount));
      
      const snap = await getDocs(q);
      const sessions = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as Session))
        .sort((a, b) => {
          const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return tb - ta;
        });
      return { sessions, lastDoc: null };
    } catch (err) {
      console.error('SessionService.getAllSessionsAdmin failed:', err);
      return { sessions: [], lastDoc: null };
    }
  },
};
