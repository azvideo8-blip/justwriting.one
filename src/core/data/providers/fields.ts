import { ProviderRecord } from '../types';

export const toMs = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : v);
export const toIso = (v: unknown) => (typeof v === 'number' ? new Date(v).toISOString() : v instanceof Date ? v.toISOString() : v);

export const DATE_COLUMNS = new Set([
  'saved_at', 'session_started_at', 'updated_at', 'first_session_at', 'last_session_at',
  'created_at', 'privacy_accepted_at', 'ai_consent_at', 'indexing_consent_at',
  'deleted_at', 'trashed_at',
]);

export const DATE_FIELDS_CLIENT = new Set([
  'savedAt', 'sessionStartedAt', 'updatedAt', 'firstSessionAt', 'lastSessionAt',
  'createdAt', 'privacyAcceptedAt', 'aiConsentAt', 'indexingConsentAt',
  'deletedAt', 'trashedAt',
]);

export const USER_FIELDS: Record<string, string> = {
  uid: 'uid',
  email: 'email',
  nickname: 'nickname',
  encryptionSalt: 'encryption_salt',
  encryptedDataKey: 'encrypted_data_key',
  encryptionMeta: 'encryption_meta',
  labels: 'labels',
  earnedAchievements: 'earned_achievements',
  totalWordCount: 'total_word_count',
  totalWords: 'total_word_count',
  sessionsCount: 'sessions_count',
  streakDays: 'streak_days',
  totalDuration: 'total_duration',
  avgWpm: 'avg_wpm',
  avgSessionWords: 'avg_session_words',
  privacyAcceptedAt: 'privacy_accepted_at',
  privacyVersion: 'privacy_version',
  aiConsentAt: 'ai_consent_at',
  aiConsentVersion: 'ai_consent_version',
  indexingConsentAt: 'indexing_consent_at',
  achievementsResetAt: 'achievements_reset_at',
  indexingConsentVersion: 'indexing_consent_version',
  aiPortrait: 'ai_portrait',
  _encrypted: '_encrypted',
  role: 'role',
  createdAt: 'created_at',
};

export const DOCUMENT_FIELDS: Record<string, string> = {
  uuid: 'uuid',
  id: 'uuid',
  userId: 'user_id',
  title: 'title',
  currentVersion: 'current_version',
  totalWords: 'total_words',
  totalDuration: 'total_duration',
  sessionsCount: 'sessions_count',
  firstSessionAt: 'first_session_at',
  lastSessionAt: 'last_session_at',
  isPublic: 'is_public',
  tags: 'tags',
  labelId: 'label_id',
  mood: 'mood',
  excludedFromAI: 'excluded_from_ai',
  _encrypted: '_encrypted',
  deletedAt: 'deleted_at',
  trashedAt: 'trashed_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

export const VERSION_FIELDS: Record<string, string> = {
  documentId: 'document_uuid',
  documentUuid: 'document_uuid',
  userId: 'user_id',
  version: 'version',
  content: 'content',
  wordCount: 'word_count',
  wordsAdded: 'words_added',
  charsAdded: 'chars_added',
  duration: 'duration',
  wpm: 'wpm',
  goalWords: 'goal_words',
  goalTime: 'goal_time',
  goalReached: 'goal_reached',
  savedAt: 'saved_at',
  sessionStartedAt: 'session_started_at',
  mood: 'mood',
  _encrypted: '_encrypted',
  createdAt: 'created_at',
};

export const DRAFT_FIELDS: Record<string, string> = {
  userId: 'user_id',
  title: 'title',
  content: 'content',
  seconds: 'seconds',
  wpm: 'wpm',
  wordCount: 'word_count',
  initialWordCount: 'initial_word_count',
  activeSessionId: 'active_session_id',
  sessionStartTime: 'session_start_time',
  accumulatedDuration: 'accumulated_duration',
  totalPauseSeconds: 'total_pause_seconds',
  savedDocumentId: 'saved_document_id',
  tags: 'tags',
  labelId: 'label_id',
  pinnedThoughts: 'pinned_thoughts',
  _encrypted: '_encrypted',
  updatedAt: 'updated_at',
};

export const AI_SUMMARY_FIELDS: Record<string, string> = {
  documentId: 'document_id',
  documentUuid: 'document_id',
  userId: 'user_id',
  summary: 'summary',
  tone: 'tone',
  frequentWords: 'frequent_words',
  authorPhrases: 'author_phrases',
  insights: 'insights',
  quotableSentence: 'quotable_sentence',
  themes: 'themes',
  extractedFacts: 'extracted_facts',
  processedAt: 'processed_at',
  commitments: 'commitments',
  valence: 'valence',
  arousal: 'arousal',
  echo: 'echo',
  contentHash: 'content_hash',
  eventDate: 'event_date',
  promptVersion: 'prompt_version',
  _encrypted: '_encrypted',
  createdAt: 'created_at',
};

export const AI_EMBEDDING_FIELDS: Record<string, string> = {
  documentId: 'document_id',
  documentUuid: 'document_id',
  userId: 'user_id',
  vectorsJson: 'vectors_json',
  chunkTextsJson: 'chunk_texts_json',
  model: 'model',
  dim: 'dim',
  contentHash: 'content_hash',
  processedAt: 'processed_at',
  schemaV: 'schema_v',
  _encrypted: '_encrypted',
  createdAt: 'created_at',
};

export function createReverseMap(fields: Record<string, string>): Record<string, string> {
  const rev: Record<string, string> = {};
  for (const [clientKey, dbCol] of Object.entries(fields)) {
    if (!rev[dbCol] || clientKey === 'documentId' || clientKey === 'uuid' || clientKey === 'totalWordCount') {
      rev[dbCol] = clientKey;
    }
  }
  return rev;
}

// Колонки для списка пользователей в админке. Перечислены поимённо, а не `*`:
// со звёздочкой в браузер админа уезжали encrypted_data_key, encryption_salt и
// encryption_meta всех пользователей — ключевой материал, которому в списке
// делать нечего. ai_portrait исключён по той же причине: это описание личности,
// а не строка статистики. Своя запись читается через getUserProfile — там поля
// на месте.
export const ADMIN_USER_COLUMNS = [
  'uid', 'email', 'nickname', 'role', 'created_at', '_encrypted',
  'labels', 'earned_achievements',
  'total_word_count', 'sessions_count', 'streak_days', 'total_duration',
  'avg_wpm', 'avg_session_words',
  'privacy_accepted_at', 'privacy_version',
  'ai_consent_at', 'ai_consent_version',
  'indexing_consent_at', 'indexing_consent_version',
].join(',');

export const USER_REV = createReverseMap(USER_FIELDS);
export const DOCUMENT_REV = createReverseMap(DOCUMENT_FIELDS);
export const VERSION_REV = createReverseMap(VERSION_FIELDS);
export const DRAFT_REV = createReverseMap(DRAFT_FIELDS);
export const AI_SUMMARY_REV = createReverseMap(AI_SUMMARY_FIELDS);
export const AI_EMBEDDING_REV = createReverseMap(AI_EMBEDDING_FIELDS);

/** Локальные версии приходят как 'v12' (VersionService), облачные — как '12'.
 *  Приводим оба вида к числу. Бросок намеренно громкий: тихий NaN уже прятал
 *  здесь один баг. */
export function parseVersionNumber(raw: string): number {
  const n = parseInt(raw.replace(/^v/i, ''), 10);
  if (!Number.isFinite(n)) throw new Error(`Unparseable version id: ${raw}`);
  return n;
}

export function toDb(fields: Record<string, string>, data: ProviderRecord): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const validCols = new Set(Object.values(fields));

  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const dbCol = fields[k] ?? (validCols.has(k) ? k : undefined);
    if (!dbCol || dbCol === 'id') continue;

    if (DATE_COLUMNS.has(dbCol) || DATE_FIELDS_CLIENT.has(k)) {
      result[dbCol] = v === null ? null : toIso(v);
    } else {
      result[dbCol] = v;
    }
  }
  return result;
}

export function fromDb(rev: Record<string, string>, row: Record<string, unknown>): ProviderRecord {
  const result: ProviderRecord = {};
  for (const [col, val] of Object.entries(row)) {
    const clientKey = rev[col] || col;
    if (DATE_COLUMNS.has(col) || DATE_FIELDS_CLIENT.has(clientKey)) {
      result[clientKey] = val === null ? null : toMs(val);
    } else if (val === null) {
      // Omit null values for non-date fields to preserve Zod schema default and optional behavior
      continue;
    } else {
      result[clientKey] = val;
    }
  }

  const idVal = row.uuid ?? row.uid ?? row.document_id ?? row.id ?? row.user_id ?? result.uuid ?? result.uid ?? result.documentId ?? result.id ?? result.userId;
  if (idVal !== undefined && idVal !== null) {
    result.id = String(idVal);
  }
  return result;
}

// В LIKE `%` и `_` — джокеры. Ключи сейчас машинные и их не содержат, но ключ
// когда-нибудь соберут из пользовательской строки, и `%` в нём снесёт все
// страничные записи стора разом. Экранируем на входе в шаблон, а не надеемся
// на форму ключа.
export function likeGlob(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, '\\$&')}%`;
}

export function likePrefix(key: string): string {
  return likeGlob(`${key}#`);
}
