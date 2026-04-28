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
  linkedCloudId?: string;
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

export interface LocalDraft {
  userId: string;
  title: string;
  content: string;
  seconds: number;
  wpm: number;
  wordCount: number;
  initialWordCount?: number;
  activeSessionId?: string | null;
  pinnedThoughts?: string[];
  sessionStartTime?: number | null;
  updatedAt: number;
}

export interface PendingSession {
  id?: number;
  sessionId: string | null;
  data: Record<string, unknown>;
  userId: string;
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
  drafts: {
    key: string;
    value: LocalDraft;
  };
  pending_sessions: {
    key: number;
    value: PendingSession;
    autoIncrement: true;
  };
}

let dbInstance: IDBPDatabase<JustWritingDB> | null = null;

export async function getLocalDb(): Promise<IDBPDatabase<JustWritingDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<JustWritingDB>('justwriting-local', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const docStore = db.createObjectStore('documents', { keyPath: 'id' });
        docStore.createIndex('by-guest', 'guestId');
        docStore.createIndex('by-lastSession', 'lastSessionAt');

        const verStore = db.createObjectStore('versions', { keyPath: 'id' });
        verStore.createIndex('by-document', 'documentId');
        verStore.createIndex('by-version', 'version');

        db.createObjectStore('profile', { keyPath: 'guestId' });
        db.createObjectStore('syncQueue', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'userId' });
        }
        if (!db.objectStoreNames.contains('pending_sessions')) {
          db.createObjectStore('pending_sessions', { keyPath: 'id', autoIncrement: true });
        }
      }
    },
  });

  return dbInstance;
}

function randomUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (HTTP)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export { randomUUID };

export function getOrCreateGuestId(): string {
  const KEY = 'jw_guest_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `guest_${randomUUID()}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}
