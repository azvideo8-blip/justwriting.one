import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { AI_SUMMARY_FIELDS, AI_SUMMARY_REV, toDb, fromDb } from './fields';
import { pageAll } from './pageAll';

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

export async function deleteAllSummaries(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('ai_summaries')
    .delete()
    .eq('user_id', userId);
  if (error != null) throw error;
}

export async function getUserSummaries(userId: string): Promise<ProviderRecord[]> {
  const allRows = await pageAll((from, to) =>
    getSupabase()
      .from('ai_summaries')
      .select('*')
      .eq('user_id', userId)
      .order('document_id', { ascending: true })
      .range(from, to),
  );
  return allRows.map(row => fromDb(AI_SUMMARY_REV, row as Record<string, unknown>));
}
