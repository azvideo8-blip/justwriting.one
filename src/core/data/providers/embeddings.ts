import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { AI_EMBEDDING_FIELDS, AI_EMBEDDING_REV, toDb, fromDb } from './fields';
import { pageAll, ownRows, ownRow } from './pageAll';

export async function getEmbedding(userId: string, documentId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('ai_embeddings')
    .select('*')
    .eq('user_id', userId)
    .eq('document_id', documentId)
    .maybeSingle();
  if (error != null) throw error;
  if (!ownRow(data, userId)) return null;
  return fromDb(AI_EMBEDDING_REV, data);
}

export async function saveEmbedding(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(AI_EMBEDDING_FIELDS, { ...data, userId, documentId });
  const { error } = await getSupabase()
    .from('ai_embeddings')
    .upsert(payload);
  if (error != null) throw error;
}

export async function deleteEmbedding(userId: string, documentId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('ai_embeddings')
    .delete()
    .eq('user_id', userId)
    .eq('document_id', documentId);
  if (error != null) throw error;
}

/** S-46: только номера заметок — векторы и тексты чанков не выкачиваются. */
export async function listEmbeddingDocumentIds(userId: string): Promise<string[]> {
  const rows = await pageAll((from, to) =>
    getSupabase()
      .from('ai_embeddings')
      .select('document_id, user_id')
      .eq('user_id', userId)
      .order('document_id', { ascending: true })
      .range(from, to),
  );
  return ownRows(rows, userId).map(r => String(r.document_id));
}

export async function deleteAllEmbeddings(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('ai_embeddings')
    .delete()
    .eq('user_id', userId);
  if (error != null) throw error;
}

export async function getUserEmbeddingsPaginated(userId: string, limitCount: number, cursorId?: string): Promise<{ items: ProviderRecord[]; nextCursorId?: string; readCount: number }> {
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
  
  const items = ownRows(data ?? [], userId).map(row => fromDb(AI_EMBEDDING_REV, row));
  const nextCursorId = data != null && data.length > 0 ? data[data.length - 1].document_id as string : undefined;
  return { items, ...(nextCursorId ? { nextCursorId } : {}), readCount: data?.length || 0 };
}

export async function getEmbeddingsPage(userId: string, limitCount: number, startAfterId?: string): Promise<ProviderRecord[]> {
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
  return ownRows(data ?? [], userId).map(row => fromDb(AI_EMBEDDING_REV, row));
}

/** Векторы, посчитанные после `sinceMs` (`processed_at`) — для обычной догрузки:
 *  заметки, разобранные на другом устройстве с прошлого прохода. */
export async function getUserEmbeddingsSince(userId: string, sinceMs: number): Promise<ProviderRecord[]> {
  const allRows = await pageAll((from, to) =>
    getSupabase()
      .from('ai_embeddings')
      .select('*')
      .eq('user_id', userId)
      .gt('processed_at', Math.floor(sinceMs))
      .order('document_id', { ascending: true })
      .range(from, to),
  );
  return ownRows(allRows, userId).map(row => fromDb(AI_EMBEDDING_REV, row as Record<string, unknown>));
}

export async function getUserEmbeddings(userId: string): Promise<ProviderRecord[]> {
  const allRows = await pageAll((from, to) =>
    getSupabase()
      .from('ai_embeddings')
      .select('*')
      .eq('user_id', userId)
      .order('document_id', { ascending: true })
      .range(from, to),
  );
  return ownRows(allRows, userId).map(row => fromDb(AI_EMBEDDING_REV, row as Record<string, unknown>));
}

/** Число векторов в облаке без выкачивания строк — см. `countSummaries`. */
export async function countEmbeddings(userId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('ai_embeddings')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error != null) throw error;
  if (count == null) throw new Error('COUNT_UNAVAILABLE: ai_embeddings');
  return count;
}
