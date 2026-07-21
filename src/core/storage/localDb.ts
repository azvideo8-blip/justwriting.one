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
  closingSummary?: string;
  temporalScope?: {
    type: 'month' | 'dateRange' | 'person' | 'none' | 'recent';
    month?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    personName?: string | undefined;
    rawText: string;
  } | undefined;
}

export interface AIDocumentSummary {
  documentId: string;
  summary?: string;
  tone: string;
  frequentWords: string[];
  insights: string[];
  themes: string[];
  extractedFacts: string[];
  mentionedPeople?: { name: string; role: string }[];
  processedAt: number;
  commitments?: string[];
  valence?: number;
  arousal?: number;
  echo?: string;
  contentHash?: string;
}

export interface AITimelineEntry {
  documentId: string;
  date: string;       // YYYY-MM-DD from document's lastSessionAt
  month: string;      // YYYY-MM for easy range queries
  facts: string[];    // extractedFacts from the summary
  summary?: string;   // AIDocumentSummary.summary (1-2 sentence overview)
  tone?: string;
  themes?: string[];
  valence?: number;
  arousal?: number;
  insights?: string[];
}

export interface AIMonthlyDigest {
  month: string;       // YYYY-MM
  narrative: string;   // 3-5 sentence plain text summary of that month
  tones: string[];     // dominant tones
  themes: string[];    // recurring themes
  noteCount: number;
  generatedAt: number;
}

export interface AIPeopleIndexEntry {
  key: string;         // person name lowercased (canonical)
  name: string;         // display name (capitalized)
  role: string;         // most recent role seen
  noteIds: string[];    // all documentIds where mentioned
  lastMentionedAt: number;  // timestamp of most recent note
  mentionCount: number;
  status?: 'active' | 'ignored' | undefined;
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
  /** True for domain facets with a fixed taxonomy label (not discovered). */
  fixedLabel?: boolean;
  /** True when the facet has only a local fallback summary and still needs an LLM summary. */
  pendingSummary?: boolean;
  /** Transient excerpt seed stored at build time so summarizePending can reconstruct LLM input; deleted after summarizing. */
  _excerptSeed?: string[];
  cloudSyncedAt?: number;
}

export interface AIDomainVector {
  cacheKey: string; // `${domainId}_${model}`
  domainId: string;
  seed: string;
  model: string;
  vector: number[];
  updatedAt: number;
}

export interface LifeStoryEntry {
  eventDate: string; // YYYY-MM-DD, keyPath
  text: string;
  sourceDocumentIds: string[];
  generatedAt: number;
  edited?: boolean;
}

export interface AIPortrait {
  id: string;
  portrait: string;
  updatedAt: number;
  generatedAtDelta: number;
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
    value: { id: string; documentId: string; type: 'document' | 'version' | 'delete' | 'portrait'; createdAt: number; };
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
  aiDomainVectors: {
    key: string;
    value: AIDomainVector;
  };
  aiTimeline: {
    key: string;
    value: AITimelineEntry;
    indexes: { 'by-month': string; 'by-date': string };
  };
  aiMonthlyDigest: {
    key: string;
    value: AIMonthlyDigest;
  };
  aiPeopleIndex: {
    key: string;
    value: AIPeopleIndexEntry;
    indexes: { 'by-lastMentioned': number };
  };
  aiCommitments: {
    key: string;
    value: {
      id: string;
      text: string;
      documentId: string;
      createdAt: number;
      date: string;
      status: 'open' | 'done' | 'stale';
      vector?: number[];
    };
  };
  aiThreads: {
    key: string;
    value: {
      id: string;
      noteIds: string[];
      summary: string;
      centroid: number[];
      lastNoteAt: number;
      memberHash: string;
      updatedAt: number;
    };
  };
  lifeStory: {
    key: string;
    value: LifeStoryEntry;
    indexes: { 'by-eventDate': string };
  };
  aiPortrait: {
    key: string;
    value: AIPortrait;
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
  dbOpenPromise = openDB<JustWritingDB>('justwriting-local', 14, {
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
        if (!store.indexNames.contains('by-doc-version'))
          store.createIndex('by-doc-version', ['documentId', 'version']);
      }
      if (oldVersion < 4) {
        // No-op: placeholder for a skipped upgrade step.
      }
      if (oldVersion < 5) {
        if (!db.objectStoreNames.contains('aiDialogues')) {
          const dialogueStore = db.createObjectStore('aiDialogues', { keyPath: 'id' });
          dialogueStore.createIndex('by-document', 'documentId');
          dialogueStore.createIndex('by-updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('aiSummaries'))
          db.createObjectStore('aiSummaries', { keyPath: 'documentId' });
        if (!db.objectStoreNames.contains('aiPersonas'))
          db.createObjectStore('aiPersonas', { keyPath: 'id' });
      }
      if (oldVersion < 6) {
        if (!db.objectStoreNames.contains('aiEmbeddings'))
          db.createObjectStore('aiEmbeddings', { keyPath: 'documentId' });
      }
      if (oldVersion < 7) {
        if (!db.objectStoreNames.contains('aiProfileFacets'))
          db.createObjectStore('aiProfileFacets', { keyPath: 'id' });
      }
      if (oldVersion < 8) {
        if (!db.objectStoreNames.contains('aiChatMemory')) {
          const memoryStore = db.createObjectStore('aiChatMemory', { keyPath: 'id' });
          memoryStore.createIndex('by-dialogue', 'sourceDialogueId');
          memoryStore.createIndex('by-updatedAt', 'updatedAt');
        }
      }
      if (oldVersion < 9) {
        if (!db.objectStoreNames.contains('aiDomainVectors')) {
          db.createObjectStore('aiDomainVectors', { keyPath: 'cacheKey' });
        }
      }
      if (oldVersion < 10) {
        if (!db.objectStoreNames.contains('aiTimeline')) {
          const timelineStore = db.createObjectStore('aiTimeline', { keyPath: 'documentId' });
          timelineStore.createIndex('by-month', 'month');
          timelineStore.createIndex('by-date', 'date');
        }
      }
      if (oldVersion < 11) {
        if (!db.objectStoreNames.contains('aiMonthlyDigest')) {
          db.createObjectStore('aiMonthlyDigest', { keyPath: 'month' });
        }
      }
      if (oldVersion < 12) {
        if (!db.objectStoreNames.contains('aiPeopleIndex')) {
          const peopleStore = db.createObjectStore('aiPeopleIndex', { keyPath: 'key' });
          peopleStore.createIndex('by-lastMentioned', 'lastMentionedAt');
        }
      }
      if (oldVersion < 13) {
        if (!db.objectStoreNames.contains('aiCommitments')) {
          db.createObjectStore('aiCommitments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('aiThreads')) {
          db.createObjectStore('aiThreads', { keyPath: 'id' });
        }
      }
      if (oldVersion < 14) {
        if (!db.objectStoreNames.contains('lifeStory')) {
          const storyStore = db.createObjectStore('lifeStory', { keyPath: 'eventDate' });
          storyStore.createIndex('by-eventDate', 'eventDate');
        }
        if (!db.objectStoreNames.contains('aiPortrait')) {
          db.createObjectStore('aiPortrait', { keyPath: 'id' });
        }
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

