import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { AI_SUMMARY_FIELDS, AI_SUMMARY_REV, toDb, fromDb } from './fields';
import { pageAll, ownRows, ownRow } from './pageAll';

export async function getSummary(userId: string, documentId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('ai_summaries')
    .select('*')
    .eq('user_id', userId)
    .eq('document_id', documentId)
    .maybeSingle();
  if (error != null) throw error;
  if (!ownRow(data, userId)) return null;
  return fromDb(AI_SUMMARY_REV, data);
}

export async function saveSummary(userId: string, documentId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(AI_SUMMARY_FIELDS, { ...data, userId, documentId });
  const { error } = await getSupabase()
    .from('ai_summaries')
    .upsert(payload);
  if (error != null) throw error;
}

export async function deleteSummary(userId: string, documentId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('ai_summaries')
    .delete()
    .eq('user_id', userId)
    .eq('document_id', documentId);
  if (error != null) throw error;
}

export async function deleteAllSummaries(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('ai_summaries')
    .delete()
    .eq('user_id', userId);
  if (error != null) throw error;
}

export async function getUserSummaries(userId: string, sinceMs?: number): Promise<ProviderRecord[]> {
  const allRows = await pageAll((from, to) => {
    let q = getSupabase()
      .from('ai_summaries')
      .select('*')
      .eq('user_id', userId);
    if (sinceMs !== undefined) q = q.gt('processed_at', Math.floor(sinceMs));
    return q.order('document_id', { ascending: true }).range(from, to);
  });
  return ownRows(allRows, userId).map(row => fromDb(AI_SUMMARY_REV, row as Record<string, unknown>));
}
