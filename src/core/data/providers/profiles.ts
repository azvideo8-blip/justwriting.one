import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import {
  USER_FIELDS, USER_REV, toDb, fromDb, ADMIN_USER_COLUMNS,
} from './fields';

export async function getProfile(userId: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('*')
    .eq('uid', userId)
    .maybeSingle();
  if (error != null) throw error;
  if (!data) return null;
  return fromDb(USER_REV, data);
}

export async function updateProfile(userId: string, data: ProviderRecord): Promise<void> {
  const payload = toDb(USER_FIELDS, data);
  delete payload.uid;
  const { error } = await getSupabase()
    .from('users')
    .update(payload)
    .eq('uid', userId);
  if (error != null) throw error;
}

export function subscribeToProfile(userId: string, onUpdate: (data: ProviderRecord | null) => void): () => void {
  let cancelled = false;

  // Первичное чтение обязательно. Firestore onSnapshot отдавал текущий
  // документ сразу, а postgres_changes присылает только изменения: без этого
  // профиль оставался пустым до первой чужой записи в строку, и приложение
  // считало, что у человека нет ни ника, ни роли, ни сейфа шифрования.
  void (async () => {
    const { data, error } = await getSupabase().from('users').select('*').eq('uid', userId).maybeSingle();
    if (cancelled) return;
    if (error != null) { onUpdate(null); return; }
    onUpdate(data ? fromDb(USER_REV, data as ProviderRecord) : null);
  })();

  const channel = getSupabase().channel(`profile:${userId}`)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'users', filter: `uid=eq.${userId}` },
        p => onUpdate(fromDb(USER_REV, p.new as ProviderRecord)))
    .subscribe();
  return () => { cancelled = true; void getSupabase().removeChannel(channel); };
}

export async function getUsers(limitCount: number): Promise<ProviderRecord[]> {
  const { data, error } = await getSupabase()
    .from('users')
    .select(ADMIN_USER_COLUMNS)
    .limit(limitCount);
  if (error != null) throw error;
  // Список колонок собран строкой, поэтому supabase-js не выводит тип строки.
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(row => fromDb(USER_REV, row));
}

export async function getAIProfile(userId: string): Promise<ProviderRecord | null> {
  return getProfile(userId);
}

export async function saveAIProfile(userId: string, data: ProviderRecord): Promise<void> {
  return updateProfile(userId, data);
}

export async function getEncryptionMeta(userId: string): Promise<ProviderRecord | null> {
  return getProfile(userId);
}

export async function saveEncryptionMeta(userId: string, data: ProviderRecord): Promise<void> {
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
}

export async function hasLegacyKey(userId: string): Promise<boolean> {
  const profile = await getProfile(userId);
  if (!profile) return false;
  return !!profile.encryptedDataKey && !profile.encryptionMeta;
}
