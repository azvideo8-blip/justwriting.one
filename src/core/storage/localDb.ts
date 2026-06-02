import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { STORAGE_KEYS } from '../constants/storageKeys';

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
  isPublic?: boolean | undefined;
  tags: string[];
  labelId?: string | undefined;
  linkedCloudId?: string | undefined;
  mood?: string | undefined;
  aiProcessed?: boolean | undefined;
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
  goalWords?: number | undefined;
  goalTime?: number | undefined;
  goalReached?: boolean | undefined;
  savedAt: number;
  sessionStartedAt: number;
  mood?: string | undefined;
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
  initialWordCount?: number | undefined;
  activeSessionId?: string | null | undefined;
  pinnedThoughts?: string[] | undefined;
  sessionStartTime?: number | null | undefined;
  accumulatedDuration?: number | undefined;
  totalPauseSeconds?: number | undefined;
  savedDocumentId?: string | null | undefined;
  tags?: string[] | undefined;
  labelId?: string | undefined;
  updatedAt: number;
}

interface PendingSession {
  id?: number;
  sessionId: string | null;
  data: Record<string, unknown>;
  userId: string;
}

export interface AIDialogue {
  id: string;
  title: string;
  personaId: string;
  personaName: string;
  personaEmoji: string;
  documentId?: string | undefined;
  messages: { role: 'user' | 'assistant'; content: string; type?: 'chat' | 'system' | undefined }[];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | undefined;
}

export interface AIDocumentSummary {
  documentId: string;
  tone: string;
  frequentWords: string[];
  insights: string[];
  themes: string[];
  extractedFacts: string[];
  processedAt: number;
}

export interface AIPersona {
  id: string;
  name: string;
  emoji: string;
  systemPrompt: string;
  isPreset: false;
  createdAt: number;
}

interface JustWritingDB extends DBSchema {
  documents: {
    key: string;
    value: LocalDocument;
    indexes: { 'by-guest': string; 'by-lastSession': number; };
  };
  versions: {
    key: string;
    value: LocalVersion;
    indexes: { 'by-document': string; 'by-version': number; 'by-doc-version': [string, number]; };
  };
  profile: { key: string; value: LocalProfile; };
  syncQueue: {
    key: string;
    value: { id: string; documentId: string; type: 'document' | 'version'; createdAt: number; };
  };
  drafts: { key: string; value: LocalDraft; };
  pending_sessions: { key: number; value: PendingSession; autoIncrement: true; };
  aiDialogues: {
    key: string;
    value: AIDialogue;
    indexes: { 'by-document': string; 'by-updatedAt': number; };
  };
  aiSummaries: { key: string; value: AIDocumentSummary; };
  aiPersonas: { key: string; value: AIPersona; };
}

let dbInstance: IDBPDatabase<JustWritingDB> | null = null;
let dbOpenPromise: Promise<IDBPDatabase<JustWritingDB>> | null = null;
let dbGeneration = 0;

export function resetDbInstance(): void {
  dbGeneration++;
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* ignore */ }
    dbInstance = null;
  }
  dbOpenPromise = null;
}

export async function getLocalDb(): Promise<IDBPDatabase<JustWritingDB>> {
  if (dbInstance) {
    try {
      if (!(dbInstance as unknown as { closed?: boolean }).closed) return dbInstance;
    } catch { /* ignore */ }
  }
  if (dbOpenPromise) return dbOpenPromise;

  const currentGeneration = dbGeneration;
  dbOpenPromise = openDB<JustWritingDB>('justwriting-local', 5, {
    upgrade(db, oldVersion, _newVersion, transaction) {
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
        if (!db.objectStoreNames.contains('drafts'))
          db.createObjectStore('drafts', { keyPath: 'userId' });
        if (!db.objectStoreNames.contains('pending_sessions'))
          db.createObjectStore('pending_sessions', { keyPath: 'id', autoIncrement: true });
      }
      if (oldVersion < 3) {
        const store = transaction!.objectStore('versions');
        store.createIndex('by-doc-version', ['documentId', 'version']);
      }
      if (oldVersion < 5) {
        const dialogueStore = db.createObjectStore('aiDialogues', { keyPath: 'id' });
        dialogueStore.createIndex('by-document', 'documentId');
        dialogueStore.createIndex('by-updatedAt', 'updatedAt');
        db.createObjectStore('aiSummaries', { keyPath: 'documentId' });
        db.createObjectStore('aiPersonas', { keyPath: 'id' });
      }
    },
    blocked() { console.warn('[localDb] Database upgrade blocked — close other tabs and reload.'); },
    blocking() {
      console.warn('[localDb] Another tab is trying to upgrade — closing this connection.');
      if (dbInstance) { dbInstance.close(); dbInstance = null; dbOpenPromise = null; }
    },
  });

  try {
    dbInstance = await dbOpenPromise;
    if (dbGeneration !== currentGeneration) {
      dbInstance.close();
      dbInstance = null;
      dbOpenPromise = null;
      return getLocalDb();
    }
    dbInstance.addEventListener('close', () => { dbInstance = null; dbOpenPromise = null; });
    return dbInstance;
  } catch (e) {
    dbOpenPromise = null;
    console.error('[localDb] Failed to open IndexedDB:', e);
    throw e;
  }
}

function randomUUID(): string { return crypto.randomUUID(); }
export { randomUUID };

export function getOrCreateGuestId(): string {
  const KEY = STORAGE_KEYS.GUEST_ID;
  let id = localStorage.getItem(KEY);
  if (!id) {
    const saved = sessionStorage.getItem(KEY);
    if (saved) { id = saved; localStorage.setItem(KEY, id); }
  }
  if (!id) { id = `guest_${randomUUID()}`; localStorage.setItem(KEY, id); }
  sessionStorage.setItem(KEY, id);
  return id;
}
