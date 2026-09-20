import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { reportError } from '../../shared/errors/reportError';
import type { DocumentFields } from '../../shared/types/common';
import { getCurrentUser } from '../auth';

// AUDIT-part2 4.2: скалярные поля наследуются от канонического DocumentFields
// (shared/types) — расхождение локальной и облачной форм ловит компилятор.
export interface LocalDocument extends DocumentFields<number> {
  id: string;
  /** Канонический идентификатор заметки: генерируется клиентом один раз и не
   *  меняется никогда. Локальный id и linkedCloudId — адреса в двух разных
   *  хранилищах; uuid — само имя заметки, о котором договариваются обе стороны.
   *  По нему ключуются производные ИИ и манифест переноса. Необязателен, пока
   *  не заполнен у всех заметок (см. C1.2). */
  uuid?: string | undefined;
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
  // Set only by an explicit Unlink. Distinguishes "the owner wants this note to
  // stay on the device" from "the link was lost", which the re-link pass would
  // otherwise restore right back.
  localOnly?: boolean | undefined;
  unlinkedByTombstone?: boolean | undefined;
  // AUDIT-MH1: номер облачной версии, от которой локально строилась последняя
  // правка. Конфликт — это расхождение с base, а не совпадение строк: две
  // устройства, пишущие одну версию от одного base, но с разными правками,
  // строками не ловятся. undefined = старое поведение (сравнение контента).
  lastSyncedCloudVersion?: number | undefined;
  // SYNC-CURSOR-3: last seen cloud state timestamp for this specific document
  lastSeenCloudUpdatedAt?: string | undefined;
  mood?: string | undefined;
  aiProcessed?: boolean | undefined;
  /** «Не показывать ИИ»: заметка исключена из разбора и из любого поиска,
   *  результат которого уходит поставщику. */
  excludedFromAI?: boolean | undefined;
  _locked?: boolean | undefined;
  _decryptionError?: boolean | undefined;
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
  labels?: Array<{ id: string; name: string; color: string }> | undefined;
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
  messages: { role: 'user' | 'assistant'; content: string; type?: 'chat' | 'system' | undefined; reasoning?: string | undefined; variants?: string[] | undefined; variantIndex?: number | undefined; searchRequest?: string | undefined; degradedReason?: string | undefined }[];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | undefined;
  /** Desired response verbosity: 'short' | 'standard' | 'detailed' */
  responseLength?: 'short' | 'standard' | 'detailed';
  /** AX-11: Separate reasoning flag (decoupled from length). */
  reasoning?: boolean;
  closingSummary?: string;
  lastExtractedIdx?: number;
}

export interface AIDialogueEvent {
  dialogueId: string;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  personaId: string;
  personaName: string;
  summary: string;
  themes?: string[];
  vector?: number[];
}

export interface AIDocumentSummary {
  documentId: string;
  /** Canonical document uuid, set at save time for future reattach by uuid. */
  documentUuid?: string;
  summary?: string;
  tone: string;
  frequentWords: string[];
  authorPhrases?: string[];
  insights: string[];
  quotableSentence?: string;
  themes: string[];
  extractedFacts: string[];
  processedAt: number;
  commitments?: string[];
  valence?: number;
  arousal?: number;
  echo?: string;
  contentHash?: string;
  eventDate?: string;
  promptVersion?: number;
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
  eventDate?: string; // YYYY-MM-DD inferred event date
}

export interface AIMonthlyDigest {
  month: string;       // YYYY-MM
  narrative: string;   // 3-5 sentence plain text summary of that month
  tones: string[];     // dominant tones
  themes: string[];    // recurring themes
  noteCount: number;
  generatedAt: number;
}

export interface AIDocumentEmbedding {
  documentId: string;
  /** Canonical document uuid, set at save time for future reattach by uuid. */
  documentUuid?: string;
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
  /** Set when the embedding exceeds cloud payload size limits (1MB) and is skipped. */
  cloudSkipped?: boolean;
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
  /** True for domain facets with a fixed taxonomy label (not discovered). */
  fixedLabel?: boolean;
  /** True when the facet has only a local fallback summary and still needs an LLM summary. */
  pendingSummary?: boolean;
  /** Transient excerpt seed stored at build time so summarizePending can reconstruct LLM input; deleted after summarizing. */
  _excerptSeed?: string[];
  cloudSyncedAt?: number;
  dialogueIds?: string[];
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

export interface ThemeEvidence {
  noteId: string;
  eventDate: string;
  sentence: string;
}

export interface ThemeRecord {
  id: string;
  theme: string;
  themeVector: number[];
  firstSeenAt: string;                 // eventDate of first note, NOT creation date
  evidence: ThemeEvidence[];           // first+last+top-N(~3), with cap
  count: number;
  lastReinforcedAt: string;            // eventDate of most recent note
  /** Момент последнего подкрепления по часам устройства (AG-MERGE-1).
   *  Строка выше — день для показа; LWW-синхронизация сверяется по этой,
   *  иначе два подкрепления одной темы в один день парсятся в одну полночь
   *  и второе устройство теряется. */
  lastReinforcedAtMs?: number;
  emotionalWeight: number;             // clamp01(max(|valence|, arousal))
  pinned?: boolean;
  sensitivity?: 'normal' | 'sensitive';
  tier: 'active' | 'archived';         // Stage 1 — always 'active'
  supersededBy?: string;               // Stage 3 reconcile field
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
    value: { id: string; documentId: string; type: 'document' | 'version' | 'delete' | 'portrait'; createdAt: number; ownerId?: string | undefined; attempts?: number | undefined; dead?: boolean | undefined; lastError?: string | undefined; ownerToken?: string | undefined; };
  };
  drafts: { key: string; value: LocalDraft; };
  pending_sessions: { key: number; value: PendingSession; autoIncrement: true; };
  aiDialogues: {
    key: string;
    value: AIDialogue;
    indexes: { 'by-document': string; 'by-updatedAt': number; };
  };
  aiDialogueEvents: {
    key: string;
    value: AIDialogueEvent;
    indexes: { 'by-date': string };
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
  aiThemeLedger: {
    key: string;
    value: ThemeRecord;
    indexes: {
      'by-tier': string;
      'by-lastReinforcedAt': string;
    };
  };
  aiInjectionJournal: {
    key: string;
    value: Record<string, unknown>;
    indexes: {
      'by-timestamp': number;
    };
  };
  aiBeliefs: {
    key: string;
    value: Record<string, unknown>;
    indexes: {
      'by-firstSeenAt': string;
      'by-createdAt': number;
      'by-verdict': string;
    };
  };
  aiBeliefRejections: {
    key: string;
    value: Record<string, unknown>;
    indexes: {
      'by-timestamp': number;
    };
  };
}

/** Транзакция апгрейда: idb не выводит её тип, когда обработчик вынесен из вызова. */
type UpgradeTx = {
  objectStore(name: string): {
    indexNames: DOMStringList;
    openCursor(): Promise<UpgradeCursor | null>;
    createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters): void;
  };
};
type UpgradeCursor = {
  value: unknown;
  update(value: unknown): void;
  continue(): Promise<UpgradeCursor | null>;
};

async function upgradeJustWritingDB(
  db: IDBPDatabase<JustWritingDB>,
  oldVersion: number,
  _newVersion: number | null,
  transaction: UpgradeTx,
) {
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
    if (!db.objectStoreNames.contains('aiEmbeddings')) {
      db.createObjectStore('aiEmbeddings', { keyPath: 'documentId' });
    }
  }
  if (oldVersion < 7) {
    if (!db.objectStoreNames.contains('aiProfileFacets')) {
      db.createObjectStore('aiProfileFacets', { keyPath: 'id' });
    }
  }
  if (oldVersion < 8) {
    if (!db.objectStoreNames.contains('aiChatMemory')) {
      const memoryStore = db.createObjectStore('aiChatMemory', { keyPath: 'id' });
      memoryStore.createIndex('by-dialogue', 'sourceDialogueId');
      memoryStore.createIndex('by-updatedAt', 'updatedAt');
    }
    if (!db.objectStoreNames.contains('aiDomainVectors')) {
      db.createObjectStore('aiDomainVectors', { keyPath: 'cacheKey' });
    }
  }
  if (oldVersion < 9) {
    if (!db.objectStoreNames.contains('aiTimeline')) {
      const timelineStore = db.createObjectStore('aiTimeline', { keyPath: 'documentId' });
      timelineStore.createIndex('by-month', 'month');
      timelineStore.createIndex('by-date', 'date');
    }
    if (!db.objectStoreNames.contains('aiMonthlyDigest')) {
      db.createObjectStore('aiMonthlyDigest', { keyPath: 'month' });
    }
    if (!db.objectStoreNames.contains('aiCommitments')) {
      db.createObjectStore('aiCommitments', { keyPath: 'id' });
    }
  }
  if (oldVersion < 10) {
    if (!db.objectStoreNames.contains('aiThreads')) {
      db.createObjectStore('aiThreads', { keyPath: 'id' });
    }
  }
  if (oldVersion < 11) {
    if (!db.objectStoreNames.contains('lifeStory')) {
      const storyStore = db.createObjectStore('lifeStory', { keyPath: 'eventDate' });
      storyStore.createIndex('by-eventDate', 'eventDate');
    }
  }
  if (oldVersion < 12) {
    if (!db.objectStoreNames.contains('aiPortrait')) {
      db.createObjectStore('aiPortrait', { keyPath: 'id' });
    }
  }
  if (oldVersion < 13) {
    if (!db.objectStoreNames.contains('aiThemeLedger')) {
      const store = db.createObjectStore('aiThemeLedger', { keyPath: 'id' });
      store.createIndex('by-tier', 'tier');
      store.createIndex('by-lastReinforcedAt', 'lastReinforcedAt');
    }
  }
  if (oldVersion < 14) {
    if (!db.objectStoreNames.contains('aiDialogueEvents')) {
      const eventStore = db.createObjectStore('aiDialogueEvents', { keyPath: 'dialogueId' });
      eventStore.createIndex('by-date', 'date');
    }
  }
  if (oldVersion < 15) {
    if (!db.objectStoreNames.contains('aiInjectionJournal')) {
      const store = db.createObjectStore('aiInjectionJournal', { keyPath: 'id' });
      store.createIndex('by-timestamp', 'timestamp');
    }
  }
  if (oldVersion < 16) {
    if (!db.objectStoreNames.contains('aiBeliefs')) {
      const beliefStore = db.createObjectStore('aiBeliefs', { keyPath: 'id' });
      beliefStore.createIndex('by-firstSeenAt', 'firstSeenAt');
      beliefStore.createIndex('by-createdAt', 'createdAt');
      beliefStore.createIndex('by-verdict', 'judgeVerdict');
    }
    if (!db.objectStoreNames.contains('aiBeliefRejections')) {
      const rejStore = db.createObjectStore('aiBeliefRejections', { keyPath: 'id' });
      rejStore.createIndex('by-timestamp', 'timestamp');
    }
  }
  if (oldVersion < 17) {
    const docStore = transaction!.objectStore('documents');
    if (!docStore.indexNames.contains('by-linkedCloudId')) {
      docStore.createIndex('by-linkedCloudId', 'linkedCloudId');
    }
  }
  if (oldVersion < 18) {
    // No-op: placeholder for schema parity.
  }
  if (oldVersion < 19) {
    const docStore = transaction!.objectStore('documents');
    if (!docStore.indexNames.contains('by-uuid')) {
      docStore.createIndex('by-uuid', 'uuid', { unique: true });
    }
  }
  if (oldVersion < 20) {
    const rawDb = db as unknown as IDBDatabase;
    if (rawDb.objectStoreNames.contains('aiPeopleIndex')) {
      rawDb.deleteObjectStore('aiPeopleIndex');
    }
    if (db.objectStoreNames.contains('aiSummaries')) {
      // DEEP-P1: курсор идёт цепочкой промисов (continue().then(strip)), а не
      // через await в теле цикла, — намеренно. Каждый следующий запрос ставится
      // из колбэка предыдущего, поэтому versionchange-транзакция остаётся
      // активной. Await над чем-то посторонним здесь её закроет, и миграция
      // оборвётся на середине с TransactionInactiveError.
      const req = transaction.objectStore('aiSummaries').openCursor();
      await req.then(function strip(cursor: UpgradeCursor | null): unknown {
        if (!cursor) return undefined;
        const value = { ...(cursor.value as object) } as AIDocumentSummary & { mentionedPeople?: unknown };
        if ('mentionedPeople' in value) {
          delete value.mentionedPeople;
          void cursor.update(value);
        }
        return cursor.continue().then(strip);
      });
    }
  }
  if (oldVersion < 21) {
    // D4.18: absent excludedFromAI means false — no data migration needed.
  }
}

export function getLocalDbName(customUid?: string | null): string {
  if (customUid === 'justwriting-local' || customUid === 'guest' || customUid?.startsWith('guest_')) {
    return 'justwriting-local';
  }
  if (customUid) {
    return `justwriting-local-${customUid}`;
  }
  const uid = getCurrentUser()?.uid;
  if (uid && uid !== 'guest' && !uid.startsWith('guest_')) return `justwriting-local-${uid}`;
  return 'justwriting-local';
}

const dbInstances = new Map<string, IDBPDatabase<JustWritingDB>>();
const dbOpenPromises = new Map<string, Promise<IDBPDatabase<JustWritingDB>>>();
let dbGeneration = 0;

export function resetDbInstance(name?: string): void {
  dbGeneration++;
  if (name) {
    const inst = dbInstances.get(name);
    if (inst) {
      try { inst.close(); } catch { /* ignore */ }
      dbInstances.delete(name);
    }
    dbOpenPromises.delete(name);
  } else {
    for (const inst of dbInstances.values()) {
      try { inst.close(); } catch { /* ignore */ }
    }
    dbInstances.clear();
    dbOpenPromises.clear();
  }
}

export async function clearAllLocalStores(customUid?: string): Promise<void> {
  const effectiveUid = customUid ?? getCurrentUser()?.uid;
  const dbName = getLocalDbName(customUid);
  try {
    const db = await getLocalDb(customUid);
    const names = Array.from(db.objectStoreNames);
    if (names.length > 0) {
      const tx = db.transaction(names, 'readwrite');
      for (const name of names) {
        if (name === 'syncQueue' && effectiveUid) {
          const queueStore = tx.objectStore('syncQueue');
          const all = await queueStore.getAll();
          for (const item of all) {
            if (!item.ownerId || item.ownerId === effectiveUid) {
              void queueStore.delete(item.id);
            }
          }
        } else {
          void tx.objectStore(name).clear();
        }
      }
      await tx.done;
    }
  } catch (e) {
    console.warn('[localDb] Failed to clear all object stores:', e);
    throw e;
  } finally {
    resetDbInstance(dbName);
  }
}

/** DEEP-14: Полное удаление файла БД при удалении аккаунта (indexedDB.deleteDatabase).
 *  Закрывает открытые соединения и гарантирует, что имя justwriting-usr_<uid>
 *  не остаётся на устройстве как артефакт существования аккаунта. */
export async function deleteLocalDatabase(customUid?: string): Promise<void> {
  const dbName = getLocalDbName(customUid);
  resetDbInstance(dbName);

  if (typeof indexedDB === 'undefined' || typeof indexedDB.deleteDatabase !== 'function') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    req.onsuccess = () => {
      if (blockedTimer) clearTimeout(blockedTimer);
      resolve();
    };
    req.onerror = () => {
      if (blockedTimer) clearTimeout(blockedTimer);
      reject(req.error ?? new Error(`Failed to delete database ${dbName}`));
    };
    req.onblocked = () => {
      console.warn(`[localDb] deleteDatabase for ${dbName} blocked by open connections`);
      if (!blockedTimer) {
        blockedTimer = setTimeout(() => {
          reject(new Error(`DATABASE_DELETION_BLOCKED: deleteDatabase for ${dbName} blocked by open connections`));
        }, 500);
      }
    };
  });
}

interface DatabaseWithClosed {
  closed?: boolean;
}

const inFlightMigrations = new Map<string, Promise<void>>();

export const LEGACY_WIPE_STORES = [
  'aiPortrait',
  'aiBeliefs',
  'aiBeliefRejections',
  'aiChatMemory',
  'aiProfileFacets',
  'aiSummaries',
  'aiEmbeddings',
  'aiDialogues',
  'aiDialogueEvents',
  'aiThemeLedger',
  'aiTimeline',
  'aiMonthlyDigest',
  'aiPersonas',
  'aiThreads',
  'lifeStory',
  'aiCommitments',
  'aiDomainVectors',
  'aiInjectionJournal',
] as const;

export async function migrateLegacyIfNeeded(targetDbName: string, targetUid: string): Promise<void> {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  if (targetDbName === 'justwriting-local') return;
  const migrationKey = `jw_legacy_migrated_${targetUid}`;
  try {
    if (localStorage.getItem(migrationKey)) return;
  } catch { /* ignore */ }

  const existing = inFlightMigrations.get(targetDbName);
  if (existing) {
    await existing;
    return;
  }

  const migrationPromise = (async () => {
    try {
      const databases = (await indexedDB.databases?.()) ?? [];
      const legacyExists = databases.some(d => d.name === 'justwriting-local');
      if (!legacyExists && databases.length > 0) {
        try { localStorage.setItem(migrationKey, 'done_no_legacy'); } catch { /* ignore */ }
        return;
      }

      const legacyDb = await openDB<JustWritingDB>('justwriting-local', 21, {
        upgrade: (db, oldV, newV, tx) => { void upgradeJustWritingDB(db, oldV, newV, tx as unknown as UpgradeTx); },
      });

      const docs = await legacyDb.getAll('documents');
      if (docs.length === 0) {
        legacyDb.close();
        try { localStorage.setItem(migrationKey, '1'); } catch { /* ignore */ }
        return;
      }

      const userDocs = docs.filter(d => d.guestId === targetUid);
      if (userDocs.length === 0) {
        legacyDb.close();
        try { localStorage.setItem(migrationKey, '1'); } catch { /* ignore */ }
        return;
      }

      // Если в legacyDb лежат заметки нескольких пользователей, миграция
      // НЕ ДОЛЖНА копировать записи без владельца (aiPortrait со старым id
      // 'singleton', aiBeliefs, aiBeliefRejections, aiChatMemory, aiProfileFacets,
      // aiSummaries, aiEmbeddings, aiDialogues, aiDialogueEvents, aiThemeLedger,
      // aiTimeline, aiMonthlyDigest, aiPersonas, aiThreads, lifeStory,
      // aiCommitments, aiDomainVectors, aiInjectionJournal) в базу первого вошедшего: они
      // могут принадлежать другому аккаунту. Копируются только документы
      // и версии текущего пользователя. Это закрывает межпользовательскую
      // утечку между аккаунтами на одном устройстве — ту самую изоляцию,
      // ради которой базу и разделяли.
      const ownersInLegacy = new Set(docs.map(d => d.guestId).filter(Boolean));
      const multiOwnerMarker = 'jw_legacy_has_multi_owners';
      let hadMultipleOwners = false;
      try {
        hadMultipleOwners = localStorage.getItem(multiOwnerMarker) === '1';
      } catch { /* ignore */ }

      if (ownersInLegacy.size > 1) {
        hadMultipleOwners = true;
        try { localStorage.setItem(multiOwnerMarker, '1'); } catch { /* ignore */ }
        // Если в общей базе жили несколько аккаунтов, записи без владельца
        // спорные. Стираем их из legacyDb, чтобы ни первый, ни второй вошедший
        // аккаунт не присвоил чужой психологический портрет.
        for (const storeName of LEGACY_WIPE_STORES) {
          if (legacyDb.objectStoreNames.contains(storeName as never)) {
            try {
              await legacyDb.clear(storeName as never);
            } catch { /* ignore */ }
          }
        }
      }

      const claimUnowned = ownersInLegacy.size <= 1 && !hadMultipleOwners;

      const targetDb = await openDB<JustWritingDB>(targetDbName, 21, {
        upgrade: (db, oldV, newV, tx) => { void upgradeJustWritingDB(db, oldV, newV, tx as unknown as UpgradeTx); },
      });

      let copyFailed = false;
      const storeNames = Array.from(legacyDb.objectStoreNames);
      for (const storeName of storeNames) {
        try {
          const records = await (legacyDb as unknown as { getAll(s: string): Promise<unknown[]> }).getAll(storeName);
          if (records.length === 0) continue;
          const tx = targetDb.transaction(storeName as never, 'readwrite');
          const targetStore = tx.objectStore(storeName as never) as unknown as { put(v: unknown): Promise<unknown> };
          for (const record of records) {
            const rec = record as { guestId?: string; userId?: string; ownerId?: string };
            if (rec.guestId && rec.guestId !== targetUid) continue;
            if (rec.userId && rec.userId !== targetUid) continue;
            if (rec.ownerId && rec.ownerId !== targetUid) continue;
            if (!rec.guestId && !rec.userId && !rec.ownerId && !claimUnowned) continue;
            await targetStore.put(record);
          }
          await tx.done;
        } catch (err) {
          copyFailed = true;
          console.warn(`[localDb] Error copying store ${storeName} in legacy migration:`, err);
        }
      }

      // Оригиналы удаляются ТОЛЬКО после проверки, что копия на месте.
      let verified = false;
      try {
        const copied = await targetDb.getAll('documents');
        const copiedIds = new Set(copied.map(d => d.id));
        verified = !copyFailed && userDocs.every(d => copiedIds.has(d.id));
      } catch (err) {
        console.warn('[localDb] Legacy migration verification failed:', err);
      }

      if (!verified) {
        console.error(
          '[localDb] Legacy migration did NOT complete: originals kept in the shared database, ' +
          'nothing deleted, migration will be retried on next open.',
        );
        targetDb.close();
        legacyDb.close();
        return;
      }

      for (const doc of userDocs) {
        try {
          await legacyDb.delete('documents', doc.id);
        } catch { /* ignore */ }
      }
      if (legacyDb.objectStoreNames.contains('drafts')) {
        try {
          await legacyDb.delete('drafts', targetUid);
        } catch { /* ignore */ }
      }
      if (claimUnowned) {
        for (const storeName of LEGACY_WIPE_STORES) {
          if (legacyDb.objectStoreNames.contains(storeName as never)) {
            try {
              await legacyDb.clear(storeName as never);
            } catch { /* ignore */ }
          }
        }
      }

      targetDb.close();
      legacyDb.close();
      try {
        localStorage.setItem(migrationKey, '1');
      } catch { /* ignore */ }
    } catch (err) {
      console.warn('[localDb] Legacy migration skipped/failed:', err);
    } finally {
      inFlightMigrations.delete(targetDbName);
    }
  })();

  inFlightMigrations.set(targetDbName, migrationPromise);
  await migrationPromise;
}

/** Полноэкранное сообщение поверх приложения: база недоступна, и делать это
 *  должен человек — закрыть вкладки или перезагрузить. Клик перезагружает. */
function showDbOverlay(text: string): void {
  if (typeof document === 'undefined' || document.body === null) return;
  if (document.getElementById('db-upgrade-blocked-overlay')) return;
  const el = document.createElement('div');
  el.id = 'db-upgrade-blocked-overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.85);color:#fff;font:16px system-ui;text-align:center;padding:24px;cursor:pointer;';
  el.textContent = text;
  el.addEventListener('click', () => { try { location.reload(); } catch { /* ignore */ } });
  document.body.appendChild(el);
}

export async function getLocalDb(customUid?: string): Promise<IDBPDatabase<JustWritingDB>> {
  const dbName = getLocalDbName(customUid);
  const existing = dbInstances.get(dbName);
  if (existing) {
    try {
      if (!(existing as DatabaseWithClosed).closed) return existing;
    } catch { /* ignore */ }
    dbInstances.delete(dbName);
  }

  const existingPromise = dbOpenPromises.get(dbName);
  if (existingPromise) return existingPromise;

  const currentGeneration = dbGeneration;
  const effectiveUid = customUid ?? getCurrentUser()?.uid;
  if (effectiveUid && dbName !== 'justwriting-local') {
    await migrateLegacyIfNeeded(dbName, effectiveUid);
  }

  const openPromise = openDB<JustWritingDB>(dbName, 21, {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    upgrade: upgradeJustWritingDB,
    blocked() {
      console.warn('[localDb] Database upgrade blocked — close other tabs and reload.');
      showDbOverlay('Закройте другие вкладки justwriting и обновите страницу — база данных ожидает обновления.');
    },
    blocking() {
      console.warn('[localDb] Another tab is trying to upgrade — closing this connection.');
      const inst = dbInstances.get(dbName);
      if (inst) {
        try { inst.close(); } catch { /* ignore */ }
        dbInstances.delete(dbName);
      }
      dbOpenPromises.delete(dbName);
    },
  });

  try {
    const db = await openPromise;
    if (dbGeneration !== currentGeneration) {
      db.close();
      dbInstances.delete(dbName);
      dbOpenPromises.delete(dbName);
      return getLocalDb(customUid);
    }
    dbInstances.set(dbName, db);
    dbOpenPromises.delete(dbName);
    db.addEventListener('close', () => {
      dbInstances.delete(dbName);
      dbOpenPromises.delete(dbName);
    });
    return db;
  } catch (e) {
    dbOpenPromises.delete(dbName);
    // DEEP-P2: VersionError = база на устройстве новее, чем знает этот бандл.
    // Так выглядит вкладка, пережившая выкатку: соседняя обновилась и подняла
    // схему, а эта работает на старом коде. Без сообщения человек видит пустой
    // архив и читает это как пропажу заметок — так уже было на бампе v6.
    // Проверяем по name, а не через instanceof Error: это DOMException, и в
    // части сред (jsdom, fake-indexeddb) он Error не наследует.
    if (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'VersionError') {
      showDbOverlay('Приложение обновилось в другой вкладке. Обновите страницу — данные на месте.');
    }
    reportError(e, { action: 'localDb_open_indexeddb', dbName });
    throw e;
  }
}

import { getOrCreateGuestId } from '../../shared/utils/guestId';
export { getOrCreateGuestId };
export function randomUUID(): string { return crypto.randomUUID(); }

