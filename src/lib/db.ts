import { openDB, IDBPDatabase } from 'idb';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../core/firebase/firestore';

const DB_NAME = 'flowwriter-db';
const STORE_NAME = 'drafts';

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

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
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
