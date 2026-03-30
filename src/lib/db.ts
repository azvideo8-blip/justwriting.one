import { openDB, IDBPDatabase } from 'idb';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../core/firebase/firestore';

const DB_NAME = 'flowwriter-db';
const STORE_NAME = 'drafts';
const PENDING_SESSIONS_STORE = 'pending_sessions';

export interface Draft {
  userId: string;
  title: string;
  content: string;
  seconds: number;
  wpm: number;
  wordCount: number;
  activeSessionId?: string | null;
  pinnedThoughts?: string[];
  updatedAt: number;
}

export interface PendingSession {
  id?: number;
  sessionId: string | null;
  data: any;
  userId: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
        }
        if (!db.objectStoreNames.contains(PENDING_SESSIONS_STORE)) {
          db.createObjectStore(PENDING_SESSIONS_STORE, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveToLocal(draft: Draft) {
  const db = await getDB();
  return db.put(STORE_NAME, draft);
}

export async function saveToFirestore(draft: Draft) {
  const docRef = doc(db, 'drafts', draft.userId);
  return setDoc(docRef, draft, { merge: true });
}

export async function getDraftFromFirestore(userId: string): Promise<Draft | undefined> {
  const docRef = doc(db, 'drafts', userId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return docSnap.data() as Draft;
  }
  return undefined;
}

export async function getDraft(userId: string): Promise<Draft | undefined> {
  const db = await getDB();
  return db.get(STORE_NAME, userId);
}

export async function deleteDraft(userId: string) {
  const db = await getDB();
  return db.delete(STORE_NAME, userId);
}

export async function savePendingSession(session: PendingSession) {
  const db = await getDB();
  return db.add(PENDING_SESSIONS_STORE, session);
}

export async function getAllPendingSessions(): Promise<PendingSession[]> {
  const db = await getDB();
  return db.getAll(PENDING_SESSIONS_STORE);
}

export async function deletePendingSession(id: number) {
  const db = await getDB();
  return db.delete(PENDING_SESSIONS_STORE, id);
}
