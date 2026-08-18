import { getSupabase } from '../supabase/client';
import { IDataProvider, ProviderRecord } from './types';

const toMs = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : v);
const toIso = (v: unknown) => (typeof v === 'number' ? new Date(v).toISOString() : v instanceof Date ? v.toISOString() : v);

const DATE_COLUMNS = new Set([
  'saved_at', 'session_started_at', 'updated_at', 'first_session_at', 'last_session_at',
  'created_at', 'privacy_accepted_at',
]);

const DATE_FIELDS_CLIENT = new Set([
  'savedAt', 'sessionStartedAt', 'updatedAt', 'firstSessionAt', 'lastSessionAt',
  'createdAt', 'privacyAcceptedAt',
]);

const USER_FIELDS: Record<string, string> = {
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
  aiPortrait: 'ai_portrait',
  _encrypted: '_encrypted',
  role: 'role',
  createdAt: 'created_at',
};

const DOCUMENT_FIELDS: Record<string, string> = {
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
  createdAt: 'created_at',
};

const VERSION_FIELDS: Record<string, string> = {
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

const DRAFT_FIELDS: Record<string, string> = {
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

const AI_SUMMARY_FIELDS: Record<string, string> = {
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

const AI_EMBEDDING_FIELDS: Record<string, string> = {
  documentId: 'document_id',
  documentUuid: 'document_id',
  userId: 'user_id',
  vectorsJson: 'vectors_json',
  vectorJson: 'vector_json',
  chunkTextsJson: 'chunk_texts_json',
  model: 'model',
  dim: 'dim',
  contentHash: 'content_hash',
  processedAt: 'processed_at',
  schemaV: 'schema_v',
  _encrypted: '_encrypted',
  createdAt: 'created_at',
};

function createReverseMap(fields: Record<string, string>): Record<string, string> {
  const rev: Record<string, string> = {};
  for (const [clientKey, dbCol] of Object.entries(fields)) {
    if (!rev[dbCol] || clientKey === 'documentId' || clientKey === 'uuid' || clientKey === 'totalWordCount') {
      rev[dbCol] = clientKey;
    }
  }
  return rev;
}

const USER_REV = createReverseMap(USER_FIELDS);
const DOCUMENT_REV = createReverseMap(DOCUMENT_FIELDS);
const VERSION_REV = createReverseMap(VERSION_FIELDS);
const DRAFT_REV = createReverseMap(DRAFT_FIELDS);
const AI_SUMMARY_REV = createReverseMap(AI_SUMMARY_FIELDS);
const AI_EMBEDDING_REV = createReverseMap(AI_EMBEDDING_FIELDS);

function toDb(fields: Record<string, string>, data: ProviderRecord): Record<string, unknown> {
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

function fromDb(rev: Record<string, string>, row: Record<string, unknown>): ProviderRecord {
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

export const SupabaseDataProvider: IDataProvider = {
  async createDocument(userId: string, data: ProviderRecord): Promise<string> {
    const docId = (data.uuid || data.id || crypto.randomUUID()) as string;
    const payload = toDb(DOCUMENT_FIELDS, { ...data, uuid: docId, userId });
    delete payload.id;
    const { error } = await getSupabase()
      .from('documents')
      .insert(payload);
    if (error != null) throw error;
    return docId;
  },

  async getDocument(userId: string, documentId: string): Promise<ProviderRecord | null> {
    const { data, error } = await getSupabase()
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .eq('uuid', documentId)
      .maybeSingle();
    if (error != null) throw error;
    if (!data) return null;
    return fromDb(DOCUMENT_REV, data);
  },

  async getUserDocuments(userId: string): Promise<ProviderRecord[]> {
    const { data, error } = await getSupabase()
      .from('documents')
      .select('*')
      .eq('user_id', userId);
    if (error != null) throw error;
    return (data ?? []).map(row => fromDb(DOCUMENT_REV, row));
  },

  async updateDocument(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
    const payload = toDb(DOCUMENT_FIELDS, data);
    delete payload.id;
    delete payload.uuid;
    delete payload.user_id;
    const { error } = await getSupabase()
      .from('documents')
      .update(payload)
      .eq('user_id', userId)
      .eq('uuid', documentId);
    if (error != null) throw error;
  },

  async updateDocumentSessionStats(
    userId: string,
    documentId: string,
    stats: {
      totalWords: number;
      totalDuration: number;
      currentVersion: number;
      mood?: string | null;
      sessionsCount?: number;
      lastSessionAt?: Date;
    }
  ): Promise<void> {
    let sessionsCount = stats.sessionsCount;
    if (sessionsCount === undefined) {
      const { data } = await getSupabase()
        .from('documents')
        .select('sessions_count')
        .eq('user_id', userId)
        .eq('uuid', documentId)
        .maybeSingle();
      sessionsCount = ((data?.sessions_count as number) || 0) + 1;
    }

    const updateData: Record<string, unknown> = {
      totalWords: stats.totalWords,
      totalDuration: stats.totalDuration,
      currentVersion: stats.currentVersion,
      sessionsCount,
      lastSessionAt: stats.lastSessionAt !== undefined ? stats.lastSessionAt : new Date(),
    };
    if (stats.mood !== undefined) updateData.mood = stats.mood;

    const payload = toDb(DOCUMENT_FIELDS, updateData);
    delete payload.id;
    delete payload.uuid;
    delete payload.user_id;

    const { error } = await getSupabase()
      .from('documents')
      .update(payload)
      .eq('user_id', userId)
      .eq('uuid', documentId);
    if (error != null) throw error;
  },

  async deleteDocument(userId: string, documentId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('documents')
      .delete()
      .eq('user_id', userId)
      .eq('uuid', documentId);
    if (error != null) throw error;
  },

  async clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('documents')
      .update({ label_id: null })
      .eq('user_id', userId)
      .eq('label_id', labelId);
    if (error != null) throw error;
  },

  async renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
    const { data } = await getSupabase().from('documents').select('uuid, tags').eq('user_id', userId).contains('tags', [oldTag]);
    if (data == null || data.length === 0) return;
    for (const doc of data) {
      const tags = (doc.tags || []) as string[];
      const newTags = Array.from(new Set(tags.map(t => (t === oldTag ? newTag : t))));
      await getSupabase().from('documents').update({ tags: newTags }).eq('user_id', userId).eq('uuid', doc.uuid);
    }
  },

  async removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
    const { data } = await getSupabase().from('documents').select('uuid, tags').eq('user_id', userId).contains('tags', [tag]);
    if (data == null || data.length === 0) return;
    for (const doc of data) {
      const tags = (doc.tags || []) as string[];
      const newTags = tags.filter(t => t !== tag);
      await getSupabase().from('documents').update({ tags: newTags }).eq('user_id', userId).eq('uuid', doc.uuid);
    }
  },

  async addVersion(userId: string, documentId: string, _versionId: string, data: ProviderRecord): Promise<void> {
    const payload = toDb(VERSION_FIELDS, { ...data, userId, documentId });
    delete payload.id;
    const { error } = await getSupabase()
      .from('versions')
      .upsert(payload);
    if (error != null) throw error;
  },

  async getVersions(userId: string, documentId: string): Promise<ProviderRecord[]> {
    const { data, error } = await getSupabase()
      .from('versions')
      .select('*')
      .eq('user_id', userId)
      .eq('document_uuid', documentId);
    if (error != null) throw error;
    return (data ?? []).map(row => fromDb(VERSION_REV, row));
  },

  async getLatestVersion(userId: string, documentId: string): Promise<ProviderRecord | null> {
    const { data, error } = await getSupabase()
      .from('versions')
      .select('*')
      .eq('user_id', userId)
      .eq('document_uuid', documentId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error != null) throw error;
    if (!data) return null;
    return fromDb(VERSION_REV, data);
  },

  async updateVersion(userId: string, documentId: string, versionId: string, data: ProviderRecord): Promise<void> {
    const payload = toDb(VERSION_FIELDS, data);
    delete payload.id;
    delete payload.document_uuid;
    delete payload.user_id;
    const { error } = await getSupabase()
      .from('versions')
      .update(payload)
      .eq('user_id', userId)
      .eq('document_uuid', documentId)
      .eq('version', parseInt(versionId, 10));
    if (error != null) throw error;
  },

  async updateVersionsBatch(userId: string, documentId: string, updates: { versionId: string; data: ProviderRecord }[]): Promise<void> {
    for (const update of updates) {
      await this.updateVersion(userId, documentId, update.versionId, update.data);
    }
  },

  async deleteVersionsBatch(userId: string, documentId: string, versionIds: string[]): Promise<void> {
    const vIds = versionIds.map(v => parseInt(v, 10));
    const { error } = await getSupabase()
      .from('versions')
      .delete()
      .eq('user_id', userId)
      .eq('document_uuid', documentId)
      .in('version', vIds);
    if (error != null) throw error;
  },

  async getProfile(userId: string): Promise<ProviderRecord | null> {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .eq('uid', userId)
      .maybeSingle();
    if (error != null) throw error;
    if (!data) return null;
    return fromDb(USER_REV, data);
  },

  async updateProfile(userId: string, data: ProviderRecord): Promise<void> {
    const payload = toDb(USER_FIELDS, data);
    delete payload.uid;
    const { error } = await getSupabase()
      .from('users')
      .update(payload)
      .eq('uid', userId);
    if (error != null) throw error;
  },

  subscribeToProfile(userId: string, onUpdate: (data: ProviderRecord | null) => void): () => void {
    const channel = getSupabase().channel(`profile:${userId}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'users', filter: `uid=eq.${userId}` },
          p => onUpdate(fromDb(USER_REV, p.new as ProviderRecord)))
      .subscribe();
    return () => { void getSupabase().removeChannel(channel); };
  },

  async getUsers(limitCount: number): Promise<ProviderRecord[]> {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .limit(limitCount);
    if (error != null) throw error;
    return (data ?? []).map(row => fromDb(USER_REV, row));
  },

  async getDraft(userId: string): Promise<ProviderRecord | null> {
    const { data, error } = await getSupabase()
      .from('drafts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error != null) throw error;
    if (!data) return null;
    return fromDb(DRAFT_REV, data);
  },

  async saveDraft(userId: string, data: ProviderRecord): Promise<void> {
    const payload = toDb(DRAFT_FIELDS, { ...data, updatedAt: new Date(), userId });
    const { error } = await getSupabase()
      .from('drafts')
      .upsert(payload);
    if (error != null) throw error;
  },

  async updateDraft(userId: string, data: ProviderRecord): Promise<void> {
    const payload = toDb(DRAFT_FIELDS, { ...data, updatedAt: new Date() });
    delete payload.user_id;
    const { error } = await getSupabase()
      .from('drafts')
      .update(payload)
      .eq('user_id', userId);
    if (error != null) throw error;
  },

  async deleteDraft(userId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('drafts')
      .delete()
      .eq('user_id', userId);
    if (error != null) throw error;
  },

  async getSummary(userId: string, documentId: string): Promise<ProviderRecord | null> {
    const { data, error } = await getSupabase()
      .from('ai_summaries')
      .select('*')
      .eq('user_id', userId)
      .eq('document_id', documentId)
      .maybeSingle();
    if (error != null) throw error;
    if (!data) return null;
    return fromDb(AI_SUMMARY_REV, data);
  },

  async saveSummary(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
    const payload = toDb(AI_SUMMARY_FIELDS, { ...data, userId, documentId });
    const { error } = await getSupabase()
      .from('ai_summaries')
      .upsert(payload);
    if (error != null) throw error;
  },

  async deleteSummary(userId: string, documentId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('ai_summaries')
      .delete()
      .eq('user_id', userId)
      .eq('document_id', documentId);
    if (error != null) throw error;
  },

  async getUserSummaries(userId: string): Promise<ProviderRecord[]> {
    const { data, error } = await getSupabase()
      .from('ai_summaries')
      .select('*')
      .eq('user_id', userId);
    if (error != null) throw error;
    return (data ?? []).map(row => fromDb(AI_SUMMARY_REV, row));
  },

  async getEmbedding(userId: string, documentId: string): Promise<ProviderRecord | null> {
    const { data, error } = await getSupabase()
      .from('ai_embeddings')
      .select('*')
      .eq('user_id', userId)
      .eq('document_id', documentId)
      .maybeSingle();
    if (error != null) throw error;
    if (!data) return null;
    return fromDb(AI_EMBEDDING_REV, data);
  },

  async saveEmbedding(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
    const payload = toDb(AI_EMBEDDING_FIELDS, { ...data, userId, documentId });
    const { error } = await getSupabase()
      .from('ai_embeddings')
      .upsert(payload);
    if (error != null) throw error;
  },

  async deleteEmbedding(userId: string, documentId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('ai_embeddings')
      .delete()
      .eq('user_id', userId)
      .eq('document_id', documentId);
    if (error != null) throw error;
  },

  async getUserEmbeddingsPaginated(userId: string, limitCount: number, cursorId?: string): Promise<{ items: ProviderRecord[]; nextCursorId?: string; readCount: number }> {
    let q = getSupabase()
      .from('ai_embeddings')
      .select('*')
      .eq('user_id', userId)
      .order('document_id', { ascending: true })
      .limit(limitCount);
      
    if (cursorId) {
      q = q.gt('document_id', cursorId);
    }
    
    const { data, error } = await q;
    if (error != null) throw error;
    
    const items = (data ?? []).map(row => fromDb(AI_EMBEDDING_REV, row));
    const nextCursorId = data != null && data.length > 0 ? data[data.length - 1].document_id as string : undefined;
    return { items, ...(nextCursorId ? { nextCursorId } : {}), readCount: data?.length || 0 };
  },

  async getEmbeddingsPage(userId: string, limitCount: number, startAfterId?: string): Promise<ProviderRecord[]> {
    let q = getSupabase()
      .from('ai_embeddings')
      .select('*')
      .eq('user_id', userId)
      .order('document_id', { ascending: true })
      .limit(limitCount);
      
    if (startAfterId) {
      q = q.gt('document_id', startAfterId);
    }
    
    const { data, error } = await q;
    if (error != null) throw error;
    return (data ?? []).map(row => fromDb(AI_EMBEDDING_REV, row));
  },

  async getAIProfile(userId: string): Promise<ProviderRecord | null> {
    return this.getProfile(userId);
  },

  async saveAIProfile(userId: string, data: ProviderRecord): Promise<void> {
    return this.updateProfile(userId, data);
  },

  async getEncryptionMeta(userId: string): Promise<ProviderRecord | null> {
    return this.getProfile(userId);
  },

  async saveEncryptionMeta(userId: string, data: ProviderRecord): Promise<void> {
    const payload = toDb(USER_FIELDS, data);
    delete payload.uid;
    
    const { error } = await getSupabase()
      .from('users')
      .update({
        ...payload,
        encryption_salt: null,
        encrypted_data_key: null,
      })
      .eq('uid', userId);
    if (error != null) throw error;
  },

  async hasLegacyKey(userId: string): Promise<boolean> {
    const profile = await this.getProfile(userId);
    if (!profile) return false;
    return !!profile.encryptedDataKey && !profile.encryptionMeta;
  },

  async applySyncChanges(userId: string, changes: {
    docsToUpdate: Array<{ id: string; data: ProviderRecord }>;
    docsToDelete: string[];
    versionsToUpdate: Array<{ documentId: string; versionId: string; data: ProviderRecord }>;
  }): Promise<void> {
    for (const update of changes.docsToUpdate) {
      const payload = toDb(DOCUMENT_FIELDS, { ...update.data, uuid: update.id, userId });
      delete payload.id;
      await getSupabase().from('documents').upsert(payload);
    }
    for (const delId of changes.docsToDelete) {
      await getSupabase().from('documents').delete().eq('user_id', userId).eq('uuid', delId);
    }
    for (const update of changes.versionsToUpdate) {
      const payload = toDb(VERSION_FIELDS, { ...update.data, documentId: update.documentId, userId });
      delete payload.id;
      await getSupabase().from('versions').upsert(payload);
    }
  },

  async getMigrationDrafts(userId: string): Promise<{ id: string; data: ProviderRecord }[]> {
    const { data, error } = await getSupabase()
      .from('drafts')
      .select('*')
      .eq('user_id', userId);
    if (error != null) throw error;
    return (data ?? []).map(d => ({ id: d.user_id as string, data: fromDb(DRAFT_REV, d) }));
  },

  async executeMigrationBatch(ops: {
    type: 'version' | 'draft';
    userId: string;
    documentId?: string;
    versionId?: string;
    draftId?: string;
    data: ProviderRecord;
  }[]): Promise<void> {
    for (const op of ops) {
      if (op.type === 'version' && op.documentId && op.versionId) {
        const payload = toDb(VERSION_FIELDS, { ...op.data, documentId: op.documentId, userId: op.userId });
        delete payload.id;
        await getSupabase().from('versions').upsert(payload);
      } else if (op.type === 'draft' && op.draftId) {
        const payload = toDb(DRAFT_FIELDS, { ...op.data, userId: op.userId });
        await getSupabase().from('drafts').upsert(payload);
      }
    }
  }
};
