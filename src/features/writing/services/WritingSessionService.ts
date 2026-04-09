import { collection, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../../../core/firebase/firestore';
import { handleFirestoreError, OperationType } from '../../../shared/lib/firestore-errors';
import { savePendingSession, getAllPendingSessions, deletePendingSession } from '../../../lib/db';
import { reportError } from '../../../core/errors/reportError';

import { SessionPayload } from '../../../types';

export const WritingSessionService = {
  saveSession: async (sessionData: SessionPayload, activeSessionId: string | null, isOnline: boolean, userId: string) => {
    try {
      if (!isOnline) {
        await savePendingSession({ sessionId: activeSessionId, data: sessionData, userId });
        return;
      }

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
      reportError(e, {
        method: activeSessionId ? 'updateDoc' : 'addDoc',
        activeSessionId: activeSessionId ?? 'none',
        isOnline: String(isOnline),
        userId,
      });
      handleFirestoreError(e, activeSessionId ? OperationType.UPDATE : OperationType.CREATE, 'sessions');
    }
  },
  
  syncPendingSessions: async (userId: string) => {
    // Migration: Move legacy localStorage sessions to IndexedDB
    const legacyPending = localStorage.getItem(`pending_sessions_${userId}`);
    if (legacyPending) {
      try {
        const sessions = JSON.parse(legacyPending);
        for (const session of sessions) {
          await savePendingSession({ sessionId: session.id, data: session.data, userId });
        }
        localStorage.removeItem(`pending_sessions_${userId}`);
      } catch (e) {
        console.error('Migration failed', e);
      }
    }

    const pending = await getAllPendingSessions();
    const userPending = pending.filter(p => p.userId === userId);
    if (userPending.length === 0) return;

    const results = { synced: 0, failed: 0 };

    for (const session of userPending) {
      try {
        if (session.sessionId) {
          await updateDoc(doc(db, 'sessions', session.sessionId), {
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
        if (session.id) {
          await deletePendingSession(session.id);
        }
        results.synced++;
      } catch (e) {
        results.failed++;
        reportError(e, { sessionId: session.sessionId ?? 'none', userId });
      }
    }

    if (results.failed > 0) {
      console.warn(`Sync: ${results.synced} ok, ${results.failed} failed`);
    }
  }
};
