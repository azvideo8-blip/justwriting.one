import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { reportError } from '../../shared/errors/reportError';

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
  messages: { role: 'user' | 'assistant'; content: string; type?: 'chat' | 'system' | undefined; reasoning?: string | undefined; variants?: string[] | undefined; variantIndex?: number | undefined }[];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | undefined;
  /** Desired response verbosity: 'short' | 'standard' | 'detailed' */
  responseLength?: 'short' | 'standard' | 'detailed';
  /** AX-11: Separate reasoning flag (decoupled from length). */
  reasoning?: boolean;
}

export interface AIDocumentSummary {
  documentId: string;
  tone: string;
  frequentWords: string[];
  insights: string[];
  themes: string[];
  extractedFacts: string[];
  mentionedPeople?: { name: string; role: string }[];
  processedAt: number;
}

export interface AIDocumentEmbedding {
  documentId: string;
  /** One vector per chunk of the note (chunked schema, schemaV >= 2). */
  vectors: number[][];
  /** Chunk texts aligned with `vectors` (schemaV >= 3). Used to assign chunks to
   *  profile domains and summarize a domain from its own excerpts. */
  chunkTexts?: string[];
  model: string;
  dim: number;
  contentHash: string;
  processedAt: number;
  /** Embedding pipeline version. Bump to force a full re-index (e.g. chunking). */
  schemaV?: number;
  /** Set when the embedding has been successfully written to the cloud. Absent
   *  = local-only (e.g. saved while E2E was locked); a later sync pass uploads it. */
  cloudSyncedAt?: number;
  /** Legacy single mean-pooled vector (schemaV 1, pre-chunking). Read-only fallback. */
  vector?: number[];
}

export interface AIPersona {
  id: string;
  name: string;
  emoji: string;
  systemPrompt: string;
  isPreset: false;
  createdAt: number;
}

export interface AIChatMemory {
  id: string;
  kind: 'fact' | 'insight' | 'commitment' | 'preference';
  text: string;
  sourceDialogueId: string;
  createdAt: number;
  updatedAt: number;
  vector?: number[];
}

/** A theme/facet of the living AI profile, derived by clustering note embeddings. */
export interface AIProfileFacet {
  id: string;
  label: string;
  summary: string;
  centroid: number[];
  noteIds: string[];
  /** Notes whose best-chunk similarity ≥ PRIMARY_THRESHOLD (0.55) — core to this facet. */
  primaryNoteIds?: string[];
  /** Notes with membership but below primary threshold — tangentially related. */
  secondaryNoteIds?: string[];
  noteCount: number;
  /** Number of chunk vectors used to compute the centroid (for weighted blend on incremental update). */
  chunkCount?: number;
  firstAt: number;       // earliest member-note session time
  lastAt: number;        // latest member-note session time
  updatedAt: number;
  /** Build-batch id, so a fresh rebuild can replace the previous generation. */
  buildId: string;
  /** New chunks assigned since last summary — triggers re-summarization. */
  dirty?: boolean;
  /** Ratio of notes with non-empty insights (0–1). High = candidate for a post. */
  insightDensity?: number;
  /** True for person facets (people), false for domain/topic facets. */
  isPerson?: boolean;
  cloudSyncedAt?: number;
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
  aiEmbeddings: { key: string; value: AIDocumentEmbedding; };
  aiProfileFacets: { key: string; value: AIProfileFacet; };
  aiPersonas: { key: string; value: AIPersona; };
  aiChatMemory: {
    key: string;
    value: AIChatMemory;
    indexes: { 'by-dialogue': string; 'by-updatedAt': number; };
  };
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

interface DatabaseWithClosed {
  closed?: boolean;
}

export async function getLocalDb(): Promise<IDBPDatabase<JustWritingDB>> {
  if (dbInstance) {
    try {
      if (!(dbInstance as DatabaseWithClosed).closed) return dbInstance;
    } catch { /* ignore */ }
  }
  if (dbOpenPromise) return dbOpenPromise;

  const currentGeneration = dbGeneration;
  dbOpenPromise = openDB<JustWritingDB>('justwriting-local', 8, {
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
      if (oldVersion < 6) {
        db.createObjectStore('aiEmbeddings', { keyPath: 'documentId' });
      }
      if (oldVersion < 7) {
        db.createObjectStore('aiProfileFacets', { keyPath: 'id' });
      }
      if (oldVersion < 8) {
        const memoryStore = db.createObjectStore('aiChatMemory', { keyPath: 'id' });
        memoryStore.createIndex('by-dialogue', 'sourceDialogueId');
        memoryStore.createIndex('by-updatedAt', 'updatedAt');
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
    reportError(e, { action: 'localDb_open_indexeddb' });
    throw e;
  }
}

import { getOrCreateGuestId } from '../../shared/utils/guestId';
export { getOrCreateGuestId };
export function randomUUID(): string { return crypto.randomUUID(); }

