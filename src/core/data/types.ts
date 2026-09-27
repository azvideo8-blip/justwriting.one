export type ProviderRecord = Record<string, unknown>;

export interface IDataProvider {
  // --- Document Operations ---
  createDocument(userId: string, data: ProviderRecord): Promise<string>;
  getDocument(userId: string, documentId: string): Promise<ProviderRecord | null>;
  getDocumentWithDeleted(userId: string, documentId: string): Promise<ProviderRecord | null>;
  getUserDocuments(userId: string): Promise<ProviderRecord[]>;
  updateDocument(userId: string, documentId: string, data: ProviderRecord): Promise<void>;
  updateDocumentSessionStats(
    userId: string, 
    documentId: string, 
    stats: {
      totalWords: number;
      totalDuration: number;
      currentVersion: number;
      mood?: string | null;      // null implies field deletion
      sessionsCount?: number;    // undefined implies incrementing by 1
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
  deleteSummary(userId: string, documentId: string): Promise<void>;
  deleteAllSummaries(userId: string): Promise<void>;

  // --- AI Embedding Operations ---
  getEmbedding(userId: string, documentId: string): Promise<ProviderRecord | null>;
  saveEmbedding(userId: string, documentId: string, data: ProviderRecord): Promise<void>;
  deleteEmbedding(userId: string, documentId: string): Promise<void>;
  deleteAllEmbeddings(userId: string): Promise<void>;
  getUserEmbeddings(userId: string): Promise<ProviderRecord[]>;
  getUserEmbeddingsPaginated(userId: string, limitCount: number, cursorId?: string): Promise<{ items: ProviderRecord[]; nextCursorId?: string; readCount: number }>;
  getEmbeddingsPage(userId: string, limitCount: number, startAfterId?: string): Promise<ProviderRecord[]>;

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
  getLocalStoreRecord(userId: string, store: string, key: string): Promise<ProviderRecord | null>;
  getLocalStoreRecords(userId: string, store?: string, sinceMs?: number): Promise<Array<{ store: string; key: string; payload: ProviderRecord; checksum?: string }>>;
  deleteLocalStoreRecord(userId: string, store: string, key: string): Promise<void>;
  deleteLocalStoreExactRecord?(userId: string, store: string, key: string): Promise<void>;
  deleteLocalStorePagedRecords?(userId: string, store: string, key: string): Promise<void>;
  deleteLocalStoreRecordsByStore(userId: string, store: string): Promise<void>;
  deleteLocalStoreRecordsByStores(userId: string, stores: string[]): Promise<void>;
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

