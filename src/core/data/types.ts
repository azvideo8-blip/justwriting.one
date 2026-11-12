export type ProviderRecord = Record<string, unknown>;

/** S1-4: таблицы, у которых есть серверный номер строки `rev` (миграция 0045). */
export type PullChangesTable = 'documents' | 'versions';

/** Строка страницы забора. `rev` — серверный номер, по нему двигается курсор. */
export interface PullChangesRow extends ProviderRecord {
  user_id: string;
  rev: number;
}

export interface PullChangesPage {
  rows: PullChangesRow[];
  /** Номер последней строки страницы; при пустой странице — `sinceRev`. */
  lastRev: number;
}

export interface LocalStoreRecordRow {
  store: string;
  key: string;
  payload: ProviderRecord;
  checksum?: string;
  stamped_at?: number;
}

/**
 * S0-1 (F-1): результат условной записи скаляра. `written: false` — облачная
 * строка ушла вперёд относительно нашей базы (конфликт); `stampedAt` — отметка,
 * которую ряд получил после принятия нашей версии (её надо запомнить устройству).
 */
export type ConditionalScalarWrite =
  | { written: true; stampedAt: number | null }
  | { written: false };

/** S2-4: элемент `sync_push` (0047). `user_id` не передаётся — сервер берёт свой. */
export type SyncPushItem =
  | { table: 'local_store_records'; op: 'put' | 'recreate'; store: string; key: string; base_rev: number | null; payload: ProviderRecord; checksum?: string | null }
  | { table: 'local_store_records'; op: 'delete'; store: string; key: string; base_rev: number | null }
  | { table: 'documents'; op: 'delta'; uuid: string; op_id: string; sessions: number; duration: number; words: number };

/** Ответ по элементу. `row` — текущая строка облака при конфликте (`null` — строки нет). */
export interface SyncPushResult {
  status: 'ok' | 'conflict' | 'duplicate' | 'missing' | 'gone' | 'rejected';
  rev?: number | null;
  stamped_at?: number;
  payload_updated_at?: unknown;
  row?: { rev: number; deleted: boolean; payload: ProviderRecord; checksum: string | null; stamped_at: number } | null;
}

export interface IDataProvider {
  // --- Document Operations ---
  createDocument(userId: string, data: ProviderRecord): Promise<string>;
  getDocument(userId: string, documentId: string): Promise<ProviderRecord | null>;
  getDocumentWithDeleted(userId: string, documentId: string): Promise<ProviderRecord | null>;
  getUserDocuments(userId: string): Promise<ProviderRecord[]>;
  /** S1-6: строки заметок по uuid, включая надгробия, пачками по 200. */
  getDocumentsByUuidsWithDeleted(userId: string, uuids: string[]): Promise<ProviderRecord[]>;
  /** S1-4: страница изменений «после номера N» по серверному `rev`. */
  pullChangesSince(userId: string, table: PullChangesTable, sinceRev: number, limit?: number): Promise<PullChangesPage>;
  syncPush(items: SyncPushItem[]): Promise<SyncPushResult[]>;
  /** S-47: подмножество `uuids`, снятых в облаке надгробием (`deleted_at is not null`). */
  listTombstonedDocumentUuids(userId: string, uuids: string[]): Promise<string[]>;
  updateDocument(userId: string, documentId: string, data: ProviderRecord): Promise<void>;
  /** S2-7: только поля строки после сессии (без счётчиков) — счётчики идут `syncPush` `delta`. */
  updateDocumentSessionMeta(
    userId: string,
    documentId: string,
    stats: { currentVersion: number; mood?: string | null; moodEncrypted?: boolean; lastSessionAt?: Date },
  ): Promise<number | null>;
  deleteDocument(userId: string, documentId: string): Promise<void>;
  clearLabelFromAllDocs(userId: string, labelId: string): Promise<void>;
  renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void>;
  removeTagFromAllDocs(userId: string, tag: string): Promise<void>;
  getCloudVersionDiscrepancyCount?(userId: string): Promise<number>;

  // --- Version Operations ---
  addVersion(userId: string, documentId: string, versionId: string, data: ProviderRecord): Promise<void>;
  getVersions(userId: string, documentId: string): Promise<ProviderRecord[]>;
  getAllVersionsForUser?(userId: string): Promise<ProviderRecord[]>;
  getLatestVersion(userId: string, documentId: string): Promise<ProviderRecord | null>;
  updateVersion(userId: string, documentId: string, versionId: string, data: ProviderRecord): Promise<void>;
  updateVersionsBatch(userId: string, documentId: string, updates: { versionId: string; data: ProviderRecord }[]): Promise<void>;
  deleteVersionsBatch(userId: string, documentId: string, versionIds: string[]): Promise<void>;

  // --- Profile & Admin Operations ---
  getProfile(userId: string): Promise<ProviderRecord | null>;
  updateProfile(userId: string, data: ProviderRecord): Promise<void>;
  subscribeToProfile(userId: string, onUpdate: (data: ProviderRecord | null, unavailable?: boolean) => void): () => void;
  getUsers(limitCount: number): Promise<ProviderRecord[]>;

  // --- Writing Draft Operations ---
  getDraft(userId: string): Promise<ProviderRecord | null>;
  /** SF-2: метка ряда, поставленная сервером (триггер 0043), в мс; `null` — не прочитали. */
  saveDraft(userId: string, data: ProviderRecord): Promise<number | null>;
  updateDraft(userId: string, data: ProviderRecord): Promise<void>;
  deleteDraft(userId: string): Promise<void>;

  // --- AI Summary Operations ---
  getSummary(userId: string, documentId: string): Promise<ProviderRecord | null>;
  saveSummary(userId: string, documentId: string, data: ProviderRecord): Promise<void>;
  getUserSummaries(userId: string, sinceMs?: number): Promise<ProviderRecord[]>;
  countSummaries(userId: string): Promise<number>;
  deleteSummary(userId: string, documentId: string): Promise<void>;
  deleteAllSummaries(userId: string): Promise<void>;
  listSummaryDocumentIds(userId: string): Promise<string[]>;

  // --- AI Embedding Operations ---
  getEmbedding(userId: string, documentId: string): Promise<ProviderRecord | null>;
  saveEmbedding(userId: string, documentId: string, data: ProviderRecord): Promise<void>;
  deleteEmbedding(userId: string, documentId: string): Promise<void>;
  deleteAllEmbeddings(userId: string): Promise<void>;
  listEmbeddingDocumentIds(userId: string): Promise<string[]>;
  getUserEmbeddings(userId: string): Promise<ProviderRecord[]>;
  getUserEmbeddingsPaginated(userId: string, limitCount: number, cursorId?: string): Promise<{ items: ProviderRecord[]; nextCursorId?: string; readCount: number }>;
  getUserEmbeddingsSince(userId: string, sinceMs: number): Promise<ProviderRecord[]>;
  getEmbeddingsPage(userId: string, limitCount: number, startAfterId?: string): Promise<ProviderRecord[]>;
  countEmbeddings(userId: string): Promise<number>;

  // --- AI Profile & Restore ---
  getAIProfile(userId: string): Promise<ProviderRecord | null>;
  saveAIProfile(userId: string, data: ProviderRecord): Promise<void>;

  // --- Encryption Meta & Legacy Keys ---
  getEncryptionMeta(userId: string): Promise<ProviderRecord | null>;
  saveEncryptionMeta(userId: string, data: ProviderRecord): Promise<void>;
  hasLegacyKey(userId: string): Promise<boolean>;

  // applySyncChanges удалён (#50): мёртвый метод, сломанный by design
  // (upsert без onConflict по PK + проглоченные ошибки). См. комментарий
  // в supabaseDataProvider.

  // --- Local Store Records Operations ---
  saveLocalStoreRecord(userId: string, store: string, key: string, payload: ProviderRecord, checksum?: string): Promise<void>;
  saveLocalStoreRecordPages(userId: string, store: string, pages: Array<{ key: string; payload: ProviderRecord }>): Promise<void>;
  /** S-34: false — облако изменилось с момента чтения (expectedUpdatedAt устарел или строка уже есть). */
  saveLocalStoreRecordIfUnchanged(userId: string, store: string, key: string, payload: ProviderRecord, expectedUpdatedAt: number | null): Promise<boolean>;
  /** S0-1 (F-1): то же для скалярных сторов, но по серверной отметке `stamped_at`. `null` база — вставка. */
  saveLocalStoreRecordIfUnstamped(userId: string, store: string, key: string, payload: ProviderRecord, baseStampedAt: number | null): Promise<ConditionalScalarWrite>;
  getLocalStoreRecord(userId: string, store: string, key: string): Promise<LocalStoreRecordRow | null>;
  getLocalStoreRecords(userId: string, store?: string, sinceMs?: number): Promise<LocalStoreRecordRow[]>;
  /** T-8: ключи и серверные отметки без нагрузки («Отправить всё»). Необязателен ради тестовых заглушек. */
  getLocalStoreStamps?(userId: string): Promise<Array<{ store: string; key: string; stamped_at?: number }>>;
  /** S-49: страницы записи `key#…` (оба формата). Необязателен только ради тестовых заглушек: у провайдера он есть всегда. */
  getLocalStoreRecordPages?(userId: string, store: string, key: string): Promise<LocalStoreRecordRow[]>;
  /** M-5: дочерние строки записи по префиксу ключа — сегменты диалога `key@seg…`. */
  getLocalStoreRecordsByKeyPrefix(userId: string, store: string, prefix: string): Promise<LocalStoreRecordRow[]>;
  countLocalStoreRecords(userId: string, stores: readonly string[]): Promise<number>;
  deleteLocalStoreRecord(userId: string, store: string, key: string): Promise<void>;
  deleteLocalStoreExactRecord?(userId: string, store: string, key: string): Promise<void>;
  deleteLocalStorePagedRecords?(userId: string, store: string, key: string, keepPages?: number): Promise<void>;
  deleteLocalStoreRecordsByStore(userId: string, store: string): Promise<void>;
  deleteLocalStoreRecordsByStores(userId: string, stores: string[]): Promise<void>;
  /** M-5: снести ровно названные строки — осиротевшие сегменты, которые head
   *  больше не перечисляет, и строки проигравшей попытки. */
  deleteLocalStoreRecordsByKeys(userId: string, store: string, keys: string[]): Promise<void>;
  deleteAllLocalStoreRecords?(userId: string): Promise<void>;

  // --- Migration ---
  getMigrationDrafts(userId: string): Promise<{ id: string; data: ProviderRecord }[]>;
  executeMigrationBatch(ops: {
    type: 'version' | 'draft' | 'document';
    userId: string;
    documentId?: string;
    versionId?: string;
    draftId?: string;
    data: ProviderRecord;
  }[]): Promise<void>;
}

