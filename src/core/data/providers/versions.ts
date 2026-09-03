import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import {
  VERSION_FIELDS, VERSION_REV, toDb, fromDb, parseVersionNumber,
} from './fields';

export async function addVersion(userId: string, documentId: string, _versionId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(VERSION_FIELDS, { ...data, userId, documentId });
  delete payload.id;
  const { error } = await getSupabase()
    .from('versions')
    .upsert(payload);
  if (error != null) throw error;
}

export async function getVersions(userId: string, documentId: string): Promise<ProviderRecord[]> {
  const PAGE_SIZE = 1000;
  let from = 0;
  const allRows: Record<string, unknown>[] = [];
  while (true) {
    const { data, error } = await getSupabase()
      .from('versions')
      .select('*')
      .eq('user_id', userId)
      .eq('document_uuid', documentId)
      .order('version', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error != null) throw error;
    if (data === null || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return allRows.map(row => fromDb(VERSION_REV, row));
}

export async function getLatestVersion(userId: string, documentId: string): Promise<ProviderRecord | null> {
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
}

export async function updateVersion(userId: string, documentId: string, versionId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(VERSION_FIELDS, data);
  delete payload.id;
  delete payload.document_uuid;
  delete payload.user_id;
  const { error } = await getSupabase()
    .from('versions')
    .update(payload)
    .eq('user_id', userId)
    .eq('document_uuid', documentId)
    .eq('version', parseVersionNumber(versionId));
  if (error != null) throw error;
}

export async function updateVersionsBatch(userId: string, documentId: string, updates: { versionId: string; data: ProviderRecord }[]): Promise<void> {
  for (const update of updates) {
    await updateVersion(userId, documentId, update.versionId, update.data);
  }
}

export async function deleteVersionsBatch(userId: string, documentId: string, versionIds: string[]): Promise<void> {
  const vIds = versionIds.map(v => parseVersionNumber(v));
  const { error } = await getSupabase()
    .from('versions')
    .delete()
    .eq('user_id', userId)
    .eq('document_uuid', documentId)
    .in('version', vIds);
  if (error != null) throw error;
}
