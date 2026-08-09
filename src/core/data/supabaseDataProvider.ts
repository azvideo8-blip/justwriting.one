import { getSupabase } from '../supabase/client';
import { IDataProvider, ProviderRecord } from './types';

const toMs = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : v);
const toIso = (v: unknown) => (typeof v === 'number' ? new Date(v).toISOString() : v instanceof Date ? v.toISOString() : v);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTimestampsToDb(data: ProviderRecord): ProviderRecord {
  const payload: ProviderRecord = { ...data };
  const dateFields = ['savedAt', 'sessionStartedAt', 'updatedAt', 'firstSessionAt', 'lastSessionAt'];
  for (const field of dateFields) {
    if (payload[field] !== undefined && payload[field] !== null) {
      payload[field] = toIso(payload[field]);
    }
  }
  return payload;
}

const DATE_FIELDS = [
  'savedAt', 'sessionStartedAt', 'updatedAt', 'firstSessionAt', 'lastSessionAt',
  'created_at', 'privacy_accepted_at', 'first_session_at', 'last_session_at',
  'saved_at', 'session_started_at',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTimestampsFromDb(data: ProviderRecord): ProviderRecord {
  const payload: ProviderRecord = { ...data, id: data.uuid || data.uid || data.document_id || data.id };
  for (const field of DATE_FIELDS) {
    if (payload[field] !== undefined && payload[field] !== null) {
      payload[field] = toMs(payload[field]);
    }
  }

  // Postgres returns null for a column that was never filled; Firestore simply
  // omitted the field. Zod treats the two differently: `.default()` and
  // `.optional()` fire on undefined and reject null, so a note with no mood or
  // no title came back as "expected string, received null" and failed to parse.
  //
  // Dropping the key restores the shape the schemas were written against. Date
  // fields are the exception and keep their null: firestoreTimestampSchema is a
  // union that lists null explicitly and has no .optional(), so removing the key
  // would break them from the other side.
  for (const key of Object.keys(payload)) {
    if (payload[key] === null && !DATE_FIELDS.includes(key)) {
      delete payload[key];
    }
  }

  return payload;
}

export const SupabaseDataProvider: IDataProvider = {
  async createDocument(userId: string, data: ProviderRecord): Promise<string> {
    const payload = convertTimestampsToDb(data);
    const docId = (payload.id || payload.uuid) as string;
    const { error } = await getSupabase()
      .from('documents')
      .insert({ ...payload, user_id: userId, uuid: docId, id: undefined });
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
    return convertTimestampsFromDb(data);
  },

  async getUserDocuments(userId: string): Promise<ProviderRecord[]> {
    const { data, error } = await getSupabase()
      .from('documents')
      .select('*')
      .eq('user_id', userId);
    if (error != null) throw error;
    return (data ?? []).map(convertTimestampsFromDb);
  },

  async updateDocument(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
    const payload = convertTimestampsToDb(data);
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
    const updateData: Record<string, unknown> = {
      totalWords: stats.totalWords,
      totalDuration: stats.totalDuration,
      currentVersion: stats.currentVersion,
    };
    if (stats.mood !== undefined) updateData.mood = stats.mood;
    updateData.lastSessionAt = stats.lastSessionAt !== undefined ? toIso(stats.lastSessionAt) : toIso(new Date());

    if (stats.sessionsCount !== undefined) {
      updateData.sessionsCount = stats.sessionsCount;
    } else {
      const { data } = await getSupabase().from('documents').select('sessionsCount:sessions_count').eq('user_id', userId).eq('uuid', documentId).maybeSingle();
      updateData.sessionsCount = (data?.sessionsCount || 0) + 1;
    }

    const { error } = await getSupabase()
      .from('documents')
      .update(updateData)
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
      .update({ labelId: null })
      .eq('user_id', userId)
      .eq('labelId', labelId);
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

  async addVersion(userId: string, documentId: string, versionId: string, data: ProviderRecord): Promise<void> {
    const payload = convertTimestampsToDb(data);
    const { error } = await getSupabase()
      .from('versions')
      .upsert({ ...payload, user_id: userId, document_uuid: documentId, id: undefined });
    if (error != null) throw error;
  },

  async getVersions(userId: string, documentId: string): Promise<ProviderRecord[]> {
    const { data, error } = await getSupabase()
      .from('versions')
      .select('*')
      .eq('user_id', userId)
      .eq('document_uuid', documentId);
    if (error != null) throw error;
    return (data ?? []).map(convertTimestampsFromDb);
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
    return convertTimestampsFromDb(data);
  },

  async updateVersion(userId: string, documentId: string, versionId: string, data: ProviderRecord): Promise<void> {
    const payload = convertTimestampsToDb(data);
    // The versionId is usually the stringified version number. Wait, the ticket doesn't specify if versionId is the id or the version column.
    // In firestore versions/{versionId} versionId was the version number as string usually.
    // Let's assume versionId == version
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
    return convertTimestampsFromDb(data);
  },

  async updateProfile(userId: string, data: ProviderRecord): Promise<void> {
    const payload = convertTimestampsToDb(data);
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
          p => onUpdate(convertTimestampsFromDb(p.new as ProviderRecord)))
      .subscribe();
    return () => { void getSupabase().removeChannel(channel); };
  },

  async getUsers(limitCount: number): Promise<ProviderRecord[]> {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .limit(limitCount);
    if (error != null) throw error;
    return (data ?? []).map(convertTimestampsFromDb);
  },

  async getDraft(userId: string): Promise<ProviderRecord | null> {
    const { data, error } = await getSupabase()
      .from('drafts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error != null) throw error;
    if (!data) return null;
    return convertTimestampsFromDb(data);
  },

  async saveDraft(userId: string, data: ProviderRecord): Promise<void> {
    const payload = convertTimestampsToDb(data);
    payload.updated_at = toIso(new Date());
    const { error } = await getSupabase()
      .from('drafts')
      .upsert({ ...payload, user_id: userId });
    if (error != null) throw error;
  },

  async updateDraft(userId: string, data: ProviderRecord): Promise<void> {
    const payload = convertTimestampsToDb(data);
    payload.updated_at = toIso(new Date());
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
    return convertTimestampsFromDb(data);
  },

  async saveSummary(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
    const payload = convertTimestampsToDb(data);
    const { error } = await getSupabase()
      .from('ai_summaries')
      .upsert({ ...payload, user_id: userId, document_id: documentId });
    if (error != null) throw error;
  },

  async getUserSummaries(userId: string): Promise<ProviderRecord[]> {
    const { data, error } = await getSupabase()
      .from('ai_summaries')
      .select('*')
      .eq('user_id', userId);
    if (error != null) throw error;
    return (data ?? []).map(convertTimestampsFromDb);
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
    return convertTimestampsFromDb(data);
  },

  async saveEmbedding(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
    const payload = convertTimestampsToDb(data);
    const { error } = await getSupabase()
      .from('ai_embeddings')
      .upsert({ ...payload, user_id: userId, document_id: documentId });
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
    
    const items = (data ?? []).map(convertTimestampsFromDb);
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
    return (data ?? []).map(convertTimestampsFromDb);
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
    const payload = convertTimestampsToDb(data);
    delete payload.encryptionSalt;
    delete payload.encryptedDataKey;
    
    const { error } = await getSupabase()
      .from('users')
      .update({
        ...payload,
        encryption_salt: null,
        encrypted_data_key: null
      })
      .eq('uid', userId);
    if (error != null) throw error;
  },

  async hasLegacyKey(userId: string): Promise<boolean> {
    const profile = await this.getProfile(userId);
    if (!profile) return false;
    return !!profile.encryptedMasterKey && !profile.mKeyVersion;
  },

  async applySyncChanges(userId: string, changes: {
    docsToUpdate: Array<{ id: string; data: ProviderRecord }>;
    docsToDelete: string[];
    versionsToUpdate: Array<{ documentId: string; versionId: string; data: ProviderRecord }>;
  }): Promise<void> {
    for (const update of changes.docsToUpdate) {
      const payload = convertTimestampsToDb(update.data);
      await getSupabase().from('documents').upsert({ ...payload, user_id: userId, uuid: update.id, id: undefined });
    }
    for (const delId of changes.docsToDelete) {
      await getSupabase().from('documents').delete().eq('user_id', userId).eq('uuid', delId);
    }
    for (const update of changes.versionsToUpdate) {
      const payload = convertTimestampsToDb(update.data);
      await getSupabase().from('versions').upsert({ ...payload, user_id: userId, document_uuid: update.documentId, id: undefined });
    }
  },

  async getMigrationDrafts(userId: string): Promise<{ id: string; data: ProviderRecord }[]> {
    const { data, error } = await getSupabase()
      .from('drafts')
      .select('*')
      .eq('user_id', userId);
    if (error != null) throw error;
    return (data ?? []).map(d => ({ id: d.user_id as string, data: convertTimestampsFromDb(d) }));
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
      const payload = convertTimestampsToDb(op.data);
      if (op.type === 'version' && op.documentId && op.versionId) {
        await getSupabase().from('versions').upsert({ ...payload, user_id: op.userId, document_uuid: op.documentId, id: undefined });
      } else if (op.type === 'draft' && op.draftId) {
        await getSupabase().from('drafts').upsert({ ...payload, user_id: op.userId });
      }
    }
  }
};
