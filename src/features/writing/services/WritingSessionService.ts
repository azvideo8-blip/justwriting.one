import { collection, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';

export const WritingSessionService = {
  saveSession: async (sessionData: any, activeSessionId: string | null) => {
    try {
      if (activeSessionId) {
        await updateDoc(doc(db, 'sessions', activeSessionId), {
          ...sessionData,
          updatedAt: Timestamp.now()
        });
      } else {
        await addDoc(collection(db, 'sessions'), {
          ...sessionData,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });
      }
    } catch (e) {
      handleFirestoreError(e, activeSessionId ? OperationType.UPDATE : OperationType.CREATE, 'sessions');
    }
  },
  
  syncPendingSessions: async (userId: string) => {
    const pending = localStorage.getItem(`pending_sessions_${userId}`);
    if (!pending) return;

    const sessions = JSON.parse(pending);
    const remaining = [];

    for (const session of sessions) {
      try {
        if (session.id) {
          await updateDoc(doc(db, 'sessions', session.id), {
            ...session.data,
            updatedAt: Timestamp.now()
          });
        } else {
          await addDoc(collection(db, 'sessions'), {
            ...session.data,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });
        }
      } catch (e) {
        remaining.push(session);
      }
    }

    if (remaining.length > 0) {
      localStorage.setItem(`pending_sessions_${userId}`, JSON.stringify(remaining));
    } else {
      localStorage.removeItem(`pending_sessions_${userId}`);
    }
  }
};
