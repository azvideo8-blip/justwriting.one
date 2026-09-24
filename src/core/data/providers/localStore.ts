import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { likePrefix } from './fields';
import { pageAll } from './pageAll';

export async function saveLocalStoreRecord(userId: string, store: string, key: string, payload: ProviderRecord, checksum?: string): Promise<void> {
  const { error } = await getSupabase()
    .from('local_store_records')
    .upsert({
      user_id: userId,
      store,
      key,
      payload,
      checksum: checksum ?? null,
    });
  if (error != null) throw error;
}

export async function getLocalStoreRecord(userId: string, store: string, key: string): Promise<ProviderRecord | null> {
  const { data, error } = await getSupabase()
    .from('local_store_records')
    .select('*')
    .eq('user_id', userId)
    .eq('store', store)
    .eq('key', key)
    .maybeSingle();
  if (error != null) throw error;
  if (!data) return null;
  return {
    store: data.store as string,
    key: data.key as string,
    payload: (data.payload ?? {}) as ProviderRecord,
    checksum: data.checksum as string | undefined,
  };
}

export async function getLocalStoreRecords(userId: string, store?: string, sinceMs?: number): Promise<Array<{ store: string; key: string; payload: ProviderRecord; checksum?: string }>> {
  const allRows = await pageAll((from, to) => {
    let q = getSupabase()
      .from('local_store_records')
      .select('*')
      .eq('user_id', userId);
    if (store) {
      q = q.eq('store', store);
    }
    // Инкрементальный забор: updatedAt лежит в payload открытым числом в мс
    // (13 цифр), поэтому текстовое сравнение совпадает с числовым.
    if (sinceMs !== undefined) {
      q = q.gt('payload->>updatedAt', String(Math.floor(sinceMs)));
    }
    // R4-7: ключ уникален только внутри store (PK — user_id, store, key); без
    // store в сортировке одинаковые ключи разных сторов переставлялись между
    // страницами, и пагинация теряла или дублировала строки.
    return q
      .order('store', { ascending: true })
      .order('key', { ascending: true })
      .range(from, to);
  });
  return (allRows as Record<string, unknown>[]).map(row => {
    const rec: { store: string; key: string; payload: ProviderRecord; checksum?: string } = {
      store: row.store as string,
      key: row.key as string,
      payload: (row.payload ?? {}) as ProviderRecord,
    };
    if (typeof row.checksum === 'string') {
      rec.checksum = row.checksum;
    }
    return rec;
  });
}

export async function deleteLocalStoreRecord(userId: string, store: string, key: string): Promise<void> {
  const { error: err1 } = await getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId)
    .eq('store', store)
    .eq('key', key);
  if (err1 != null) throw err1;

  const { error: err2 } = await getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId)
    .eq('store', store)
    .like('key', likePrefix(key));
  if (err2 != null) throw err2;
}

export async function deleteLocalStoreExactRecord(userId: string, store: string, key: string): Promise<void> {
  const { error } = await getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId)
    .eq('store', store)
    .eq('key', key);
  if (error != null) throw error;
}

export async function deleteLocalStorePagedRecords(userId: string, store: string, key: string): Promise<void> {
  const { error } = await getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId)
    .eq('store', store)
    .like('key', likePrefix(key));
  if (error != null) throw error;
}

export async function deleteLocalStoreRecordsByStore(userId: string, store: string): Promise<void> {
  const { error } = await getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId)
    .eq('store', store);
  if (error != null) throw error;
}

export async function deleteLocalStoreRecordsByStores(userId: string, stores: string[]): Promise<void> {
  if (stores.length === 0) return;
  const { error } = await getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId)
    .in('store', stores);
  if (error != null) throw error;
}

export async function deleteAllLocalStoreRecords(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId);
  if (error != null) throw error;
}
