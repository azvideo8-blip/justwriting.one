import { ownRows, ownRow } from './pageAll';
import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { toTimestampMs } from '../../utils/dateUtils';
import {
  DRAFT_FIELDS, DRAFT_REV, VERSION_FIELDS, DOCUMENT_FIELDS, toDb, fromDb,
} from './fields';

export async function getDraft(userId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('drafts')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error != null) throw error;
  if (!ownRow(data, userId)) return null;
  return fromDb(DRAFT_REV, data);
}

/**
 * SF-2: запись возвращает серверную метку ряда (`updated_at`), которую поставил
 * триггер 0043, а не часы прибора. Вызывающему она нужна как отметка «до какой
 * облачной версии я написался» — без неё спор черновика решают часы устройства,
 * отстающего на минуты. `null` — метку не прочитали: это «не знаю», а не «нулевая».
 */
export async function saveDraft(userId: string, data: ProviderRecord): Promise<number | null> {
  const payload = toDb(DRAFT_FIELDS, { ...data, updatedAt: new Date(), userId });
  const { data: written, error } = await getSupabase()
    .from('drafts')
    .upsert(payload)
    .select('updated_at')
    .maybeSingle();
  if (error != null) throw error;
  return toTimestampMs((written as ProviderRecord | null)?.updated_at);
}

export async function updateDraft(userId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(DRAFT_FIELDS, { ...data, updatedAt: new Date() });
  delete payload.user_id;
  const { error } = await getSupabase()
    .from('drafts')
    .update(payload)
    .eq('user_id', userId);
  if (error != null) throw error;
}

export async function deleteDraft(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('drafts')
    .delete()
    .eq('user_id', userId);
  if (error != null) throw error;
}

export async function getMigrationDrafts(userId: string): Promise<{ id: string; data: ProviderRecord }[]> {
  const { data, error } = await getSupabase()
    .from('drafts')
    .select('*')
    .eq('user_id', userId);
  if (error != null) throw error;
  return ownRows(data ?? [], userId).map(d => ({ id: d.user_id as string, data: fromDb(DRAFT_REV, d) }));
}

export async function executeMigrationBatch(ops: {
  type: 'version' | 'draft' | 'document';
  userId: string;
  documentId?: string;
  versionId?: string;
  draftId?: string;
  data: ProviderRecord;
}[]): Promise<void> {
  // Ошибку здесь глотать нельзя: вызывающий (encryptMigration) после
  // возврата помечает батч мигрированным и стирает чекпоинт. Отказ RLS или
  // конфликт ключа прошли бы как успех, и незашифрованная заметка осталась бы
  // в облаке навсегда — при том, что миграция отчиталась «готово».
  for (const op of ops) {
    if (op.type === 'version' && op.documentId && op.versionId) {
      const payload = toDb(VERSION_FIELDS, { ...op.data, documentId: op.documentId, userId: op.userId });
      delete payload.id;
      const { error } = await getSupabase().from('versions').upsert(payload);
      if (error != null) throw error;
    } else if (op.type === 'draft' && op.draftId) {
      const payload = toDb(DRAFT_FIELDS, { ...op.data, userId: op.userId });
      const { error } = await getSupabase().from('drafts').upsert(payload);
      if (error != null) throw error;
    } else if (op.type === 'document' && op.documentId) {
      const payload = toDb(DOCUMENT_FIELDS, { ...op.data, uuid: op.documentId, userId: op.userId });
      delete payload.id;
      const { error } = await getSupabase().from('documents').update(payload).eq('user_id', op.userId).eq('uuid', op.documentId);
      if (error != null) throw error;
    }
  }
}
