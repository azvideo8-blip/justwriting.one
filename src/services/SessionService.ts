import { doc, updateDoc, deleteDoc, setDoc, onSnapshot, query, where, collection, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../core/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { Session } from '../types';

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
      await deleteDoc(doc(db, 'sessions', sessionId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `sessions/${sessionId}`);
    }
  },

  subscribeToSessions(userId: string, callback: (sessions: Session[]) => void, onError: (err: any) => void) {
    const q = query(collection(db, 'sessions'), where('userId', '==', userId));
    return onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Session));
      callback(docs);
    }, onError);
  },

  subscribeToPublicSessions(callback: (sessions: Session[]) => void, onError: (err: any) => void) {
    const q = query(collection(db, 'sessions'), where('isPublic', '==', true), limit(100));
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

  async getAllSessions(userId: string) {
    try {
      const q = query(collection(db, 'sessions'), where('userId', '==', userId), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as Session));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'sessions');
      return [];
    }
  },

  async getAllSessionsAdmin(limitCount: number = 50) {
    try {
      const q = query(collection(db, 'sessions'), orderBy('createdAt', 'desc'), limit(limitCount));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as Session));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'sessions');
      return [];
    }
  },
};
