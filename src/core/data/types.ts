export type ProviderRecord = Record<string, unknown>;

export interface LocalStoreRecordRow {
  store: string;
  key: string;
  payload: ProviderRecord;
  checksum?: string;
  stamped_at?: number;
}

export interface IDataProvider {
  // --- Document Operations ---
  createDocument(userId: string, data: ProviderRecord): Promise<string>;
  getDocument(userId: string, documentId: string): Promise<ProviderRecord | null>;
  getDocumentWithDeleted(userId: string, documentId: string): Promise<ProviderRecord | null>;
  getUserDocuments(userId: string): Promise<ProviderRecord[]>;
  /** S-47: подмножество `uuids`, снятых в облаке надгробием (`deleted_at is not null`). */
  listTombstonedDocumentUuids(userId: string, uuids: string[]): Promise<string[]>;
  updateDocument(userId: string, documentId: string, data: ProviderRecord): Promise<void>;
  updateDocumentSessionStats(
    userId: string, 
    documentId: string, 
    stats: {
      totalWords: number;
      /** V-5: приращение длительности за ЭТУ выгрузку, а не абсолют: складывает
       *  сервер (0039), поэтому два устройства не теряют счёт друг друга. */
      durationDelta: number;
      currentVersion: number;
      mood?: string | null;      // null implies field deletion
      moodEncrypted?: boolean;   // mood is ciphertext: the row must be encrypted as a whole
      /** R7Q-003: приращение числа ходов за ЭТУ выгрузку; абсолют из локальной
       *  копии не шлётся — им устаревший писатель откатывал облачный счётчик. */
      sessionsDelta?: number;    // undefined implies incrementing by 1
      lastSessionAt?: Date;      // undefined implies using the current server time
    }
  ): Promise<void>;
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
  saveDraft(userId: string, data: ProviderRecord): Promise<void>;
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

