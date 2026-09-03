import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { maybeEncrypt, maybeDecrypt } from '../../crypto/cryptoHelpers';
import { reportError } from '../../../shared/errors/reportError';
import {
  DOCUMENT_FIELDS, DOCUMENT_REV, toDb, fromDb,
} from './fields';

export async function createDocument(userId: string, data: ProviderRecord): Promise<string> {
  const docId = (data.uuid || data.id || crypto.randomUUID()) as string;
  const payload = toDb(DOCUMENT_FIELDS, { ...data, uuid: docId, userId });
  delete payload.id;
  const { error } = await getSupabase()
    .from('documents')
    .insert(payload);
  if (error != null) throw error;
  return docId;
}

export async function getDocument(userId: string, documentId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .eq('uuid', documentId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error != null) throw error;
  if (!data) return null;
  return fromDb(DOCUMENT_REV, data);
}

export async function getDocumentWithDeleted(userId: string, documentId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .eq('uuid', documentId)
    .maybeSingle();
  if (error != null) throw error;
  if (!data) return null;
  return fromDb(DOCUMENT_REV, data);
}

export async function getUserDocuments(userId: string): Promise<ProviderRecord[]> {
  const PAGE_SIZE = 1000;
  let from = 0;
  const allRows: Record<string, unknown>[] = [];
  while (true) {
    const { data, error } = await getSupabase()
      .from('documents')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('uuid', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error != null) throw error;
    if (data === null || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows.map(row => fromDb(DOCUMENT_REV, row));
}

export async function updateDocument(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(DOCUMENT_FIELDS, data);
  delete payload.id;
  delete payload.uuid;
  delete payload.user_id;
  const { error } = await getSupabase()
    .from('documents')
    .update(payload)
    .eq('user_id', userId)
    .eq('uuid', documentId)
    .is('deleted_at', null);
  if (error != null) throw error;
}

export async function updateDocumentSessionStats(
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
  if (stats.sessionsCount === undefined) {
    // Атомарно в БД (0020): две вкладки или два устройства больше не
    // теряют инкременты из-за read-modify-write гонки.
    const { error: rpcError } = await getSupabase()
      .rpc('increment_document_sessions', { p_uuid: documentId, p_delta: 1 });
    if (rpcError != null) throw rpcError;
  }

  const updateData: Record<string, unknown> = {
    totalWords: stats.totalWords,
    totalDuration: stats.totalDuration,
    currentVersion: stats.currentVersion,
    ...(stats.sessionsCount !== undefined ? { sessionsCount: stats.sessionsCount } : {}),
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
    .eq('uuid', documentId)
    .is('deleted_at', null);
  if (error != null) throw error;
}

export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  const supabase = getSupabase();
  // 1. Delete associated child records (versions, AI summaries, AI embeddings).
  // Ошибку проверяем на каждом: смысл надгробия в том, что содержимое стёрто,
  // а не спрятано. Молча провалившееся удаление версий оставило бы текст
  // заметки в облаке при документе, помеченном удалённым, — и следующий шаг
  // (RLS запрещает менять надгробие) сделал бы это необратимым.
  const versionsDel = await supabase
    .from('versions')
    .delete()
    .eq('user_id', userId)
    .eq('document_uuid', documentId);
  if (versionsDel.error != null) throw versionsDel.error;

  const summariesDel = await supabase
    .from('ai_summaries')
    .delete()
    .eq('user_id', userId)
    .eq('document_id', documentId);
  if (summariesDel.error != null) throw summariesDel.error;

  const embeddingsDel = await supabase
    .from('ai_embeddings')
    .delete()
    .eq('user_id', userId)
    .eq('document_id', documentId);
  if (embeddingsDel.error != null) throw embeddingsDel.error;

  // 2. Set tombstone on document row (zeroing metadata columns and setting deleted_at)
  const { error } = await supabase
    .from('documents')
    .update({
      deleted_at: new Date().toISOString(),
      title: '',
      tags: [],
      mood: null,
      label_id: null,
      is_public: false,
      _encrypted: false,
      total_words: 0,
      total_duration: 0,
      sessions_count: 0,
    })
    .eq('user_id', userId)
    .eq('uuid', documentId);
  if (error != null) throw error;
}

export async function clearLabelFromAllDocs(userId: string, labelId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('documents')
    .update({ label_id: null })
    .eq('user_id', userId)
    .eq('label_id', labelId)
    .is('deleted_at', null);
  if (error != null) throw error;
}

export async function renameTagInAllDocs(userId: string, oldTag: string, newTag: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('documents')
    .select('uuid, tags, _encrypted')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (error != null || data == null || data.length === 0) return;
  const failedUuids: string[] = [];

  for (const doc of data) {
    let tags: string[] = [];
    try {
      const decrypted = await maybeDecrypt(
        { tags: doc.tags, _encrypted: doc._encrypted },
        [],
        ['tags']
      );
      tags = Array.isArray(decrypted.tags) ? (decrypted.tags as string[]) : [];
    } catch (e) {
      reportError(e, { action: 'renameTagInAllDocs_decrypt', docUuid: doc.uuid });
      continue;
    }

    if (tags.includes(oldTag)) {
      const newTags = Array.from(new Set(tags.map(t => (t === oldTag ? newTag : t))));
      const encrypted = await maybeEncrypt({ tags: newTags }, [], ['tags'], userId);
      const { error: updateError } = await getSupabase()
        .from('documents')
        .update({
          tags: encrypted.tags,
          _encrypted: (encrypted._encrypted as boolean) ?? doc._encrypted ?? false,
        })
        .eq('user_id', userId)
        .eq('uuid', doc.uuid);
      if (updateError != null) {
        failedUuids.push(doc.uuid ?? '');
        reportError(updateError, { action: 'renameTagInAllDocs_update', docUuid: doc.uuid });
      }
    }
  }
  if (failedUuids.length > 0) {
    throw new Error(`TAG_OP_PARTIAL:${failedUuids.length}`);
  }
}

export async function removeTagFromAllDocs(userId: string, tag: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from('documents')
    .select('uuid, tags, _encrypted')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (error != null || data == null || data.length === 0) return;
  const failedUuids: string[] = [];

  for (const doc of data) {
    let tags: string[] = [];
    try {
      const decrypted = await maybeDecrypt(
        { tags: doc.tags, _encrypted: doc._encrypted },
        [],
        ['tags']
      );
      tags = Array.isArray(decrypted.tags) ? (decrypted.tags as string[]) : [];
    } catch (e) {
      reportError(e, { action: 'removeTagFromAllDocs_decrypt', docUuid: doc.uuid });
      continue;
    }

    if (tags.includes(tag)) {
      const newTags = tags.filter(t => t !== tag);
      const encrypted = await maybeEncrypt({ tags: newTags }, [], ['tags'], userId);
      // Ошибка per-doc апдейта — это не «успех»: проглоченный отказ RLS или
      // сети оставлял тег в облаке, и следующий синк воскрешал его в UI.
      const { error: updateError } = await getSupabase()
        .from('documents')
        .update({
          tags: encrypted.tags,
          _encrypted: (encrypted._encrypted as boolean) ?? doc._encrypted ?? false,
        })
        .eq('user_id', userId)
        .eq('uuid', doc.uuid);
      if (updateError != null) {
        failedUuids.push(doc.uuid ?? '');
        reportError(updateError, { action: 'removeTagFromAllDocs_update', docUuid: doc.uuid });
      }
    }
  }
  if (failedUuids.length > 0) {
    throw new Error(`TAG_OP_PARTIAL:${failedUuids.length}`);
  }
}
