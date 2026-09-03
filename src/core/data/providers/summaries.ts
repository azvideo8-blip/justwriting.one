import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { AI_SUMMARY_FIELDS, AI_SUMMARY_REV, toDb, fromDb } from './fields';

export async function getSummary(userId: string, documentId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('ai_summaries')
    .select('*')
    .eq('user_id', userId)
    .eq('document_id', documentId)
    .maybeSingle();
  if (error != null) throw error;
  if (!data) return null;
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

export async function getUserSummaries(userId: string): Promise<ProviderRecord[]> {
  const PAGE_SIZE = 1000;
  let from = 0;
  const allRows: Record<string, unknown>[] = [];
  while (true) {
    const { data, error } = await getSupabase()
      .from('ai_summaries')
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
  return allRows.map(row => fromDb(AI_SUMMARY_REV, row));
}
