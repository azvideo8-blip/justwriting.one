import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface LocalDocument {
  id: string;
  guestId: string;
  title: string;
  currentVersion: number;
  totalWords: number;
  totalDuration: number;
  sessionsCount: number;
  firstSessionAt: number;
  lastSessionAt: number;
  isPublic: false;
  tags: string[];
}

export interface LocalVersion {
  id: string;
  documentId: string;
  guestId: string;
  version: number;
  content: string;
  wordCount: number;
  wordsAdded: number;
  charsAdded: number;
  duration: number;
  wpm: number;
  goalWords?: number;
  goalTime?: number;
  goalReached?: boolean;
  savedAt: number;
  sessionStartedAt: number;
}

export interface LocalProfile {
  guestId: string;
  totalWords: number;
  sessionsCount: number;
  totalDuration: number;
  lastSessionAt: number;
}

interface JustWritingDB extends DBSchema {
  documents: {
    key: string;
    value: LocalDocument;
    indexes: {
      'by-guest': string;
      'by-lastSession': number;
    };
  };
  versions: {
    key: string;
    value: LocalVersion;
    indexes: {
      'by-document': string;
      'by-version': number;
    };
  };
  profile: {
    key: string;
    value: LocalProfile;
  };
  syncQueue: {
    key: string;
    value: {
      id: string;
      documentId: string;
      type: 'document' | 'version';
      createdAt: number;
    };
  };
}

let dbInstance: IDBPDatabase<JustWritingDB> | null = null;

export async function getLocalDb(): Promise<IDBPDatabase<JustWritingDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<JustWritingDB>('justwriting-local', 1, {
    upgrade(db) {
      const docStore = db.createObjectStore('documents', { keyPath: 'id' });
      docStore.createIndex('by-guest', 'guestId');
      docStore.createIndex('by-lastSession', 'lastSessionAt');

      const verStore = db.createObjectStore('versions', { keyPath: 'id' });
      verStore.createIndex('by-document', 'documentId');
      verStore.createIndex('by-version', 'version');

      db.createObjectStore('profile', { keyPath: 'guestId' });
      db.createObjectStore('syncQueue', { keyPath: 'id' });
    },
  });

  return dbInstance;
}

export function getOrCreateGuestId(): string {
  const KEY = 'jw_guest_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `guest_${crypto.randomUUID()}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}
