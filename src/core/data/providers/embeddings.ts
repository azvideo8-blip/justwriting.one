import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { AI_EMBEDDING_FIELDS, AI_EMBEDDING_REV, toDb, fromDb } from './fields';

export async function getEmbedding(userId: string, documentId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('ai_embeddings')
    .select('*')
    .eq('user_id', userId)
    .eq('document_id', documentId)
    .maybeSingle();
  if (error != null) throw error;
  if (!data) return null;
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
  
  const items = (data ?? []).map(row => fromDb(AI_EMBEDDING_REV, row));
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
  return (data ?? []).map(row => fromDb(AI_EMBEDDING_REV, row));
}

export async function getUserEmbeddings(userId: string): Promise<ProviderRecord[]> {
  const PAGE_SIZE = 1000;
  let from = 0;
  const allRows: Record<string, unknown>[] = [];
  while (true) {
    const { data, error } = await getSupabase()
      .from('ai_embeddings')
      .select('*')
      .eq('user_id', userId)
      .order('document_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error != null) throw error;
    if (data === null || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows.map(row => fromDb(AI_EMBEDDING_REV, row));
}

