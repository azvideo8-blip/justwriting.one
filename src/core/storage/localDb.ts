import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { reportError } from '../../shared/errors/reportError';
import type { DocumentFields } from '../../shared/types/common';
import { getCurrentUser } from '../auth';
import { clearStoredSession } from '../auth/storedSession';

// Версия схемы IndexedDB для всех openDB. Поднимается вместе с новой веткой
// миграции в upgradeJustWritingDB. Сами ветки остаются числами: ветка N должна
// срабатывать только для баз ниже N, а не заново при каждом подъёме версии.
export const DB_VERSION = 21;

/**
 * SF-5: сторы, чьи записи помнят серверную отметку облачной версии
 * (`_cloudStampedAt`), от которой получена локальная копия.
 */
export const CLOUD_STAMP_STORES: readonly string[] = [
  'aiPortrait',
  'aiProfileFacets',
  'aiDialogueEvents',
  'aiChatMemory',
  'lifeStory',
  'aiThemeLedger',
  'aiTimeline',
  'aiBeliefs',
  'aiBeliefRejections',
  'aiCommitments',
  'aiMonthlyDigest',
  'aiThreads',
  'aiPersonas',
];

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
  isTooLargeForSync?: boolean | undefined;
  /** R3-1: правка названия/тегов/метки/даты/«не показывать ИИ» не дошла до облака.
   *  Дренаж по этому флагу отправляет метаданные целиком и снимает флаг. */
  metadataDirty?: boolean | undefined;
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
  /**
   * SF-2: серверная метка (`drafts.updated_at`, триггер 0043) той облачной версии,
   * которую это устройство видело последней. Служебное поле прибора, в облако не
   * едет (нет в DRAFT_CLOUD_FIELDS) — как `_cloudStampedAt` у ИИ-сторов.
   */
  _cloudUpdatedAt?: number | undefined;
  /**
   * SF2-1: хэш нагрузки, ПРИНЯТОЙ облаком последней. От него считается признак
   * «в локальной копии есть правки, которые ещё не уехали». Служебное поле
   * прибора, в облако не едет.
   */
  _cloudAckedHash?: string | undefined;
  /**
   * SF2-1: хэши последних ОТПРАВЛЕННЫХ в облако нагрузок, ответа на которые мы не
   * видели (старшие в начале, потолок — `SENT_HASH_CAP` в core/sync/sentHashes).
   * Нужны именно списком: на плохой сети подряд падают несколько сохранений, и
   * облако может держать любое из них.
   * Совпал ли хэш облачной строки с этим списком — единственный способ
   * отличить «там наша запись, ответа мы не видели» от «правили на другом
   * устройстве». Без этого признака спор черновика затирает дописанный текст.
   */
  _cloudSentHashes?: string[] | undefined;
}

interface PendingSession {
  id?: number;
  sessionId: string | null;
  data: Record<string, unknown>;
  userId: string;
}

export interface DialogueMessage {
  role: 'user' | 'assistant';
  content: string;
  type?: 'chat' | 'system' | undefined;
  reasoning?: string | undefined;
  variants?: string[] | undefined;
  variantIndex?: number | undefined;
  searchRequest?: string | undefined;
  degradedReason?: string | undefined;
  /**
   * S-29: опознаёт реплику при слиянии двух реплик диалога. Без него слияние
   * невозможное: сопоставлять сообщения по позиции — это терять ход того, кто
   * дописал в соседнем устройстве.
   */
  id?: string | undefined;
  /** Момент создания на том устройстве, где реплику написали. */
  createdAt?: number | undefined;
  /**
   * S-36: момент последней правки на месте (смена варианта, перегенерация).
   * При слиянии побеждает более свежая копия реплики, а не локальная.
   */
  updatedAt?: number | undefined;
  /**
   * S-36: id вопроса, на который отвечает реплика ассистента. Порядок хвоста
   * при слиянии — по ходам; без ссылки ход угадывался по соседству в массиве,
   * и ответ, чей вопрос удалён, на разных устройствах вставал по-разному.
   */
  turnId?: string | undefined;
}

export interface AIDialogue {
  id: string;
  title: string;
  personaId: string;
  personaName: string;
  personaEmoji: string;
  documentId?: string | undefined;
  messages: DialogueMessage[];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | undefined;
  /** Desired response verbosity: 'short' | 'standard' | 'detailed' */
  responseLength?: 'short' | 'standard' | 'detailed';
  /** AX-11: Separate reasoning flag (decoupled from length). */
  reasoning?: boolean;
  closingSummary?: string;
  lastExtractedIdx?: number;
  /** S-29: курсор извлечения памяти по id реплики, а не по позиции. */
  lastExtractedMessageId?: string | undefined;
  /**
   * S-29: удалённые реплики. Без записи об удалении слияние возвращает их из
   * второй реплики, и исчезнувший ответ появляется снова. S-37: с моментом
   * удаления — старше 90 дней отметка снимается, иначе список растёт вечно.
   */
  deletedMessages?: { id: string; at: number }[] | undefined;
  /**
   * S-37: запись сделана клиентом, который ставит id репликам и пишет отметки
   * об удалении. Без маркера запись пришла от старого клиента (0.9.28): её
   * реплики без id подбираются к нашим по роли и тексту, а пропавшие в ней
   * реплики не считаются удалёнными.
   */
  schema?: 2 | undefined;
  /**
   * S-58: надгробие диалога. Удаление — не стирание строки, а запись с этой
   * отметкой: иначе устройство, ещё державшее диалог, дописывало ход и
   * возвращало его в облако. При слиянии удаление побеждает; снимается через
   * TOMBSTONE_TTL_MS (list() стирает запись и облачную строку).
   */
  deletedAt?: number | undefined;
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
  /**
   * Приёмка ai-privacy: заметки, по которым собран пересказ. Читатели отдают
   * дайджест, только если все они ещё живы в хронологии месяца; у старого
   * дайджеста поля нет — он не отдаётся до пересборки (по действию человека).
   */
  noteIds?: string[];
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
  /**
   * AP-2: заметки, на которые опиралась реплика-источник (цитаты `[#id]` окна
   * извлечения). Память без этого поля — накопленная до 0.10.4: источник
   * неизвестен, ИИ её не получает до просмотра человеком (`reviewedAt`).
   */
  sourceDocumentIds?: string[];
  /**
   * Решение владельца 2026-10-20 (AP-2, вариант «в»): память без источника (до
   * 0.10.4) не отдаётся ИИ, пока человек её не просмотрит; «вернуть в контекст»
   * ставит эту отметку.
   */
  reviewedAt?: number;
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
  /** PX-3: хэш промптов разделов, по которым собран портрет; нет — портрет прежних правил. */
  promptVersion?: string;
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

export interface JustWritingDB extends DBSchema {

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
    value: { id: string; documentId: string; type: 'document' | 'version' | 'delete' | 'portrait'; createdAt: number; updatedAt?: number | undefined; ownerId?: string | undefined; attempts?: number | undefined; dead?: boolean | undefined; lastError?: string | undefined; ownerToken?: string | undefined; networkSince?: number | undefined; networkStallReported?: boolean | undefined; };
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

/**
 * Имена полей — `CLOUD_STAMP_FIELD`, `CLOUD_BASE_HASH_FIELD` и
 * `CLOUD_SENT_HASHES_FIELD` в `LocalStoreSyncService`; здесь литералы, потому что
 * импорт сервиса создал бы цикл (сервис получает базу отсюда). SF2-2: кроме
 * отметки ряда переносятся и два хэша — на них держится различение «там наша же
 * запись» и «там чужая правка», и потеря их писателем означает вечный конфликт.
 */
const CLOUD_SYNC_KEYS: ReadonlyArray<{ key: string; holds: (v: unknown) => boolean }> = [
  { key: '_cloudStampedAt', holds: v => typeof v === 'number' && Number.isFinite(v) },
  { key: '_cloudBaseHash', holds: v => typeof v === 'string' },
  // SF3-3: след отправки — список, а не одна строка (пустой список — «не помним»,
  // он переносится как значение, а не выкидывается как нечитаемое поле).
  { key: '_cloudSentHashes', holds: v => Array.isArray(v) },
];

type StampStore = {
  put(store: string, value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
  transaction(store: string, mode: IDBTransactionMode): {
    objectStore(name: string): {
      keyPath: IDBObjectStore['keyPath'];
      get(query: IDBValidKey): Promise<unknown>;
      put(value: unknown, query?: IDBValidKey): Promise<IDBValidKey>;
    };
    done: Promise<void>;
  };
};

function carriedFields(record: Record<string, unknown>) {
  return CLOUD_SYNC_KEYS.filter(f => !f.holds(record[f.key]));
}

/**
 * SF2-5: перенос синхронных полей скалярной строки — тем же правилом, которым
 * живёт обёртка `db.put`. Нужен отдельным экспортом, потому что два писателя
 * (`AIDialogueService.generateClosingSummary`, `AITimelineService.rebuildFromSummaries`)
 * пишут внутри собственной транзакции через `tx.objectStore(...).put` и прокси
 * до них не доходит: строка собрана заново, и серверная отметка с хэшами
 * терялись — ровно класс F-1 (без базы выгрузка берёт ТЕКУЩИЙ штамп облака своей
 * базой, условие проходит по построению, чужая версия пертирается молча).
 *
 * SF2-2: хэш базы относится к КОНКРЕТНОЙ отметке ряда — приносится только вместе
 * с ней. Иначе запись, принёсшая штамп другой версии, получила бы чужой хэш базы,
 * и настоящая правка второго устройства прошла бы как «наше же содержимое».
 */
export function carryCloudSyncFields(
  record: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
): Record<string, unknown> {
  let next: Record<string, unknown> = record;
  const sameStamp = previous?.['_cloudStampedAt'] === (record['_cloudStampedAt'] ?? previous?.['_cloudStampedAt']);
  for (const f of carriedFields(record)) {
    if (f.key === '_cloudBaseHash' && !sameStamp) continue;
    const value = previous?.[f.key];
    if (f.holds(value)) next = { ...next, [f.key]: value };
  }
  return next;
}

/**
 * SF-5: `_cloudStampedAt` — отметка той облачной версии, от которой получена
 * локальная копия. На ней держится условная запись (CAS): без неё писатель
 * читает облако и берёт его ТЕКУЩИЙ штамп своей базой, условие проходит по
 * построению, и защита остаётся только в окне «чтение → запись» — то есть
 * более новая чужая версия перетирается молча.
 *
 * Писатели ИИ-сторов собирают объект заново и поле теряют
 * (`AIProfileService.savePortrait` кладёт `{ id, portrait, updatedAt,
 * generatedAtDelta }`). Переносим отметку здесь, в единственной точке записи,
 * а не в 30 сервисах: поле принадлежит синхронизации, а не состоянию редактора,
 * и требовать его от каждого нового писателя — значит гарантировать новый пропуск.
 *
 * Ключ выводим по `keyPath` стора (у скалярных он `'id'`, у `aiTimeline` —
 * `'documentId'`), чтение прежней записи и правка — одной транзакцией. Не сумели
 * вывести ключ или транзакция упала — пишем как без обёртки: потеря отметки лучше
 * потери записи.
 */
function putPreservingCloudStamp(
  db: StampStore,
  store: string,
  value: unknown,
  key?: IDBValidKey,
): Promise<IDBValidKey> {
  const plain = () => (key === undefined ? db.put(store, value) : db.put(store, value, key));
  const record = value as Record<string, unknown> | null;
  const plainObject = record !== null && typeof record === 'object' && !Array.isArray(record);
  if (!CLOUD_STAMP_STORES.includes(store) || !plainObject) return plain();
  if (carriedFields(record).length === 0) return plain();
  return (async () => {
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      // Ключ может лежать в самой строке (`keyPath: 'id'`) — тогда вызывать put с
      // явным ключом нельзя: IndexedDB отвечает DataError. Явный ключ передаём только
      // для сторов с внешним ключом.
      const inline = typeof os.keyPath === 'string';
      const derived: unknown = inline ? record[os.keyPath as string] : undefined;
      const target: IDBValidKey | undefined = key
        ?? (typeof derived === 'string' || typeof derived === 'number' || derived instanceof Date ? derived : undefined);
      if (target === undefined) {
        await tx.done;
        return plain();
      }
      const prev = await os.get(target) as Record<string, unknown> | undefined;
      const next = carryCloudSyncFields(record, prev);
      await (inline && key === undefined ? os.put(next) : os.put(next, target));
      await tx.done;
      return target;
    } catch (err) {
      reportError(err, { action: 'putPreservingCloudStamp', store }, 'warning');
      return plain();
    }
  })();
}

function withCloudStampPreservation(db: IDBPDatabase<JustWritingDB>): IDBPDatabase<JustWritingDB> {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'put') {
        return (store: string, value: unknown, key?: IDBValidKey) =>
          putPreservingCloudStamp(target as unknown as StampStore, store, value, key);
      }
      const current = Reflect.get(target, prop, target) as unknown;
      return typeof current === 'function' ? (current as (...a: unknown[]) => unknown).bind(target) : current;
    },
  });
}

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

/**
 * R3-3: перенос гостевых заметок в аккаунт перепривязывает их к uid и в общей базе
 * браузера (`justwriting-local`), а стирание чистило только базу аккаунта —
 * дневник оставался в соседней базе. Убираем из общей всё, что принадлежит uid.
 */
async function purgeAccountFromSharedDb(uid: string): Promise<void> {
  const shared = await getLocalDb('justwriting-local');
  const docs = await shared.getAllFromIndex('documents', 'by-guest', uid);
  const tx = shared.transaction(['documents', 'versions', 'drafts'], 'readwrite');
  for (const doc of docs) void tx.objectStore('documents').delete(doc.id);
  // Версии — по владельцу, а не по заметке: одноразовая миграция общей базы
  // (migrateLegacyIfNeeded) убирает заметки, но не их версии.
  let cursor = await tx.objectStore('versions').openCursor();
  while (cursor) {
    if (cursor.value.guestId === uid) void cursor.delete();
    cursor = await cursor.continue();
  }
  void tx.objectStore('drafts').delete(uid);
  await tx.done;
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
    if (effectiveUid && dbName !== 'justwriting-local') {
      await purgeAccountFromSharedDb(effectiveUid);
      await cleanLegacySharedDb(effectiveUid);
    }
  } catch (e) {
    console.warn('[localDb] Failed to clear all object stores:', e);
    throw e;
  } finally {
    resetDbInstance(dbName);
  }
}

const OWNED_SHARED_STORES = new Set<string>(['documents', 'versions', 'profile', 'drafts', 'syncQueue', 'pending_sessions']);

function isGuestOwner(owner: string | undefined): boolean {
  return !owner || owner === 'guest' || owner.startsWith('guest_');
}

/**
 * S-33 (поверх O-5): при удалении аккаунта и при стирании данных оборвавшейся
 * сессии из общей базы `justwriting-local` уходят гостевые записи и записи этого
 * uid. Строки другого аккаунта, который не входил сюда после разделения баз (их
 * переносит migrateLegacyIfNeeded при его первом входе), остаются — удаление
 * всего файла базы уносило их вместе с гостевыми.
 *
 * S-52: хранилища без владельца (производные ИИ) не трогаются. Гость строк ИИ
 * создать не может (callAi требует токен), а записи этого uid после разделения
 * баз живут в `justwriting-local-<uid>`, — значит, строки ИИ без владельца здесь
 * принадлежат аккаунту, который ещё не входил после разделения, и их отдаст ему
 * миграция (claimUnowned). Файл базы удаляется, только если в ней не осталось
 * ни одной строки с владельцем.
 */
export async function wipeGuestAndAccountFromSharedDb(uid: string): Promise<void> {
  const db = await getLocalDb('justwriting-local');
  const names = Array.from(db.objectStoreNames).filter(name => OWNED_SHARED_STORES.has(name));
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) {
    const store = tx.objectStore(name);
    let cursor = await store.openCursor();
    while (cursor) {
      const rec = cursor.value as { guestId?: string; userId?: string; ownerId?: string };
      const owner = rec.guestId ?? rec.userId ?? rec.ownerId;
      if (owner === uid || isGuestOwner(owner)) void cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
  let remaining = 0;
  for (const name of names) remaining += await db.count(name as never);
  if (remaining === 0) await deleteLocalDatabase('justwriting-local');
  else resetDbInstance('justwriting-local');
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

/**
 * S-28: есть ли на устройстве база этого uid — по этому признаку предложение
 * «удалить данные с этого устройства» показывается, а не всегда подряд.
 * Safari `indexedDB.databases()` не реализует: там открываем с фиксацией
 * upgradeneeded — несозданная база встанет пустой и тут же удалится,
 * существующая откроется без апгрейда.
 */
export async function hasLocalDatabase(customUid: string): Promise<boolean> {
  const name = getLocalDbName(customUid);
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases === 'function') {
    return (await indexedDB.databases()).some(d => d.name === name);
  }
  return new Promise<boolean>(resolve => {
    let existed = true;
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => { existed = false; };
    req.onblocked = () => resolve(true);
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      req.result.close();
      if (!existed) void indexedDB.deleteDatabase(name);
      resolve(existed);
    };
  });
}

/**
 * R6Q-023 (S-9): завершение очистки удалённого аккаунта при старте приложения,
 * если в момент удаления локальное стирание не прошло (сбой IndexedDB/памяти/питания).
 * Возвращает uid, чьи базы стёрты: ключи localStorage этого аккаунта снимает
 * вызывающий (S-63, finishPendingPurges) — core не импортирует features/auth.
 */
export async function processPendingPurges(): Promise<string[]> {
  if (typeof localStorage === 'undefined') return [];
  const pendingUids: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('jw_pending_purge_')) {
        pendingUids.push(key.slice('jw_pending_purge_'.length));
      }
    }
  } catch {
    return [];
  }

  // S-48: маркер пишется только после подтверждения сервера (S-32), так что
  // «маркер + сохранённая сессия этого uid» значит одно: вкладка умерла между
  // удалением на сервере и signOutUser. Сессия несуществующего аккаунта
  // снимается до любого await — иначе клиент успеет её восстановить.
  for (const uid of pendingUids) clearStoredSession(uid);

  const purged: string[] = [];
  for (const uid of pendingUids) {
    try {
      await deleteLocalDatabase(uid);
      // S-28: маркер покрывает и гостевую базу — при удалении аккаунта с неё
      // уходят те же данные, что и с базы аккаунта (S-33: только гостевые и
      // этого uid, записи других аккаунтов остаются).
      await wipeGuestAndAccountFromSharedDb(uid);
      localStorage.removeItem(`jw_pending_purge_${uid}`);
      purged.push(uid);
    } catch (e) {
      reportError(e, { action: 'processPendingPurges', uid });
    }
  }
  return purged;
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

const SHARED_CLEANED_KEY = 'jw_shared_db_cleaned_v1';

/**
 * LG-1: миграция до 88cbc35b (2026-09-19) уносила из общей базы только документы
 * аккаунта — версии, профиль и ИИ-хранилища оставались, а к уже мигрировавшим
 * очистка не возвращается (выход на `docs.length === 0`). Разово чистим остаток.
 * Гостевое (документы, их версии, черновики) не трогаем. Пока в общей базе есть
 * документы аккаунта, ещё не входившего после разделения, ИИ-строки без владельца
 * — его (S-52, их отдаст claimUnowned): тогда чистим только сирот, флаг не ставим.
 *
 * R-10: `documents` читаются в той же readwrite-транзакции, что чистит версии.
 * Отдельным снимком гостевая вкладка успевала сохранить документ+версию между
 * чтением и курсором, и единственная версия новой заметки уходила как сирота.
 * Версии гостя не трогаем вовсе — гостевая заметка без версии хуже лишней версии.
 */
export async function cleanLegacySharedDb(currentUid?: string): Promise<void> {
  try {
    if (localStorage.getItem(SHARED_CLEANED_KEY)) return;
  } catch { return; }
  try {
    // Safari без databases() — список пуст, открываем как миграция выше.
    const listed = (await indexedDB.databases?.()) ?? [];
    if (listed.length > 0 && !listed.some(d => d.name === 'justwriting-local')) {
      localStorage.setItem(SHARED_CLEANED_KEY, '1');
      return;
    }
    const shared = await getLocalDb('justwriting-local');
    const wipeable = Array.from(shared.objectStoreNames).filter(n => (LEGACY_WIPE_STORES as readonly string[]).includes(n));
    const tx = shared.transaction([...wipeable, 'documents', 'versions', 'profile'], 'readwrite');
    // Не прочитали документы — не знаем, чьё здесь лежит: бросаем, ничего не стерев.
    const docs = await tx.objectStore('documents').getAll();
    const docIds = new Set(docs.map(d => d.id));
    const pending = new Set(docs.map(d => d.guestId).filter(o => !isGuestOwner(o)));
    if (currentUid && pending.has(currentUid) && localStorage.getItem(`jw_legacy_migrated_${currentUid}`)) {
      // R-11: миграция отмечена сделанной, а документ этого аккаунта всё ещё здесь
      // (не удалился при переносе) — чистка не наступит никогда. Один сигнал, без
      // прохода по версиям на каждом открытии базы.
      const stuckKey = `jw_shared_db_stuck_${currentUid}`;
      if (!localStorage.getItem(stuckKey)) {
        localStorage.setItem(stuckKey, '1');
        reportError(new Error('Legacy shared db still holds documents of a migrated account'), { action: 'cleanLegacySharedDb', uid: currentUid });
      }
      return;
    }
    if (!pending.size) for (const name of wipeable) void tx.objectStore(name).clear();
    let v = await tx.objectStore('versions').openCursor();
    while (v) {
      if (!isGuestOwner(v.value.guestId) && !docIds.has(v.value.documentId)) void v.delete();
      v = await v.continue();
    }
    let p = await tx.objectStore('profile').openCursor();
    while (p) {
      if (!isGuestOwner(p.value.guestId) && !pending.has(p.value.guestId)) void p.delete();
      p = await p.continue();
    }
    await tx.done;
    if (!pending.size) localStorage.setItem(SHARED_CLEANED_KEY, '1');
  } catch (e) {
    reportError(e, { action: 'cleanLegacySharedDb' });
  }
}

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

      const legacyDb = await openDB<JustWritingDB>('justwriting-local', DB_VERSION, {
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
      // R3-13: ИИ-записи в этом случае локально теряются сознательно — они
      // возвращаются из облака (local_store_records) при следующей синхронизации;
      // случай бывает только у тех, кто пришёл до разделения баз.
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
            } catch { /* намеренно: очистка legacy-хранилища при миграции best-effort */ }
          }
        }
      }

      const claimUnowned = ownersInLegacy.size <= 1 && !hadMultipleOwners;

      const targetDb = await openDB<JustWritingDB>(targetDbName, DB_VERSION, {
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
        } catch { /* намеренно: удаление из legacyDb после успешной миграции best-effort */ }
      }
      if (legacyDb.objectStoreNames.contains('drafts')) {
        try {
          await legacyDb.delete('drafts', targetUid);
        } catch { /* намеренно: удаление черновика из legacyDb best-effort */ }
      }
      if (claimUnowned) {
        for (const storeName of LEGACY_WIPE_STORES) {
          if (legacyDb.objectStoreNames.contains(storeName as never)) {
            try {
              await legacyDb.clear(storeName as never);
            } catch { /* намеренно: очистка legacy-хранилища best-effort */ }
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
function showDbOverlay(text: string, reason: 'blocked' | 'outdated' = 'outdated'): void {
  if (typeof document === 'undefined' || document.body === null) return;
  const current = document.getElementById('db-upgrade-blocked-overlay');
  if (current) {
    if (current.dataset.reason === reason) return;
    current.remove();
  }
  const el = document.createElement('div');
  el.id = 'db-upgrade-blocked-overlay';
  el.dataset.reason = reason;
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
    await cleanLegacySharedDb(effectiveUid);
  }

  const openPromise = openDB<JustWritingDB>(dbName, DB_VERSION, {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    upgrade: upgradeJustWritingDB,
    blocked() {
      console.warn('[localDb] Database upgrade blocked — close other tabs and reload.');
      showDbOverlay('Закройте другие вкладки justwriting и обновите страницу — база данных ожидает обновления.', 'blocked');
    },
    blocking() {
      console.warn('[localDb] Another tab is trying to upgrade — closing this connection.');
      // DA-14: раньше вкладка закрывала базу молча, и следующая запись падала
      // общей ошибкой. Говорим сразу: текст на экране, а сохранённое — в базе.
      showDbOverlay('Приложение обновилось в другой вкладке. Обновите страницу — сохранённое на месте.');
      const inst = dbInstances.get(dbName);
      if (inst) {
        try { inst.close(); } catch { /* ignore */ }
        dbInstances.delete(dbName);
      }
      dbOpenPromises.delete(dbName);
    },
  }).then(withCloudStampPreservation);

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
    // Другие вкладки закрылись — база открылась: оверлей «ожидает обновления» больше не нужен.
    if (typeof document !== 'undefined') {
      const overlay = document.getElementById('db-upgrade-blocked-overlay');
      if (overlay?.dataset.reason === 'blocked') overlay.remove();
    }
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

