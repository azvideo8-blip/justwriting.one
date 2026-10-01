import { getSupabase } from '../../supabase/client';
import { ProviderRecord } from '../types';
import { likePrefix } from './fields';
import { pageAll, ownRows, ownRow } from './pageAll';

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

/**
 * S-34: запись «если облако не изменилось»: строки нет — insert (23505, если
 * кто-то успел создать), есть — update с условием на прежний `updatedAt`
 * payload'а. false — облако ушло вперёд, вызывающий перечитывает и сливает
 * заново; прежний слепой upsert затирал ход другого устройства.
 */
export async function saveLocalStoreRecordIfUnchanged(
  userId: string,
  store: string,
  key: string,
  payload: ProviderRecord,
  expectedUpdatedAt: number | null,
): Promise<boolean> {
  const row = { user_id: userId, store, key, payload, checksum: null };
  if (expectedUpdatedAt === null) {
    const { error } = await getSupabase().from('local_store_records').insert(row);
    if (error != null) {
      if (error.code === '23505') return false;
      throw error;
    }
    return true;
  }
  const { data, error } = await getSupabase()
    .from('local_store_records')
    .update({ payload, checksum: null })
    .eq('user_id', userId)
    .eq('store', store)
    .eq('key', key)
    .eq('payload->>updatedAt', String(expectedUpdatedAt))
    .select('key');
  if (error != null) throw error;
  return Array.isArray(data) && data.length === 1;
}

/** Страницы одной версии записи `key#N` — одним запросом. Upsert массивом — это
 *  один INSERT … ON CONFLICT, то есть одна транзакция: другое устройство не увидит
 *  новую страницу 0 рядом со старой страницей 1 («Newest version … is incomplete»),
 *  как было при записи по одной странице. */
export async function saveLocalStoreRecordPages(userId: string, store: string, pages: Array<{ key: string; payload: ProviderRecord }>): Promise<void> {
  const { error } = await getSupabase()
    .from('local_store_records')
    .upsert(pages.map(p => ({ user_id: userId, store, key: p.key, payload: p.payload, checksum: null })));
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
  if (!ownRow(data, userId)) return null;
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
  return ownRows(allRows as Record<string, unknown>[], userId).map(row => {
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

/** Страницы `key#N`. С `keepPages` удаляются только N ≥ keepPages — хвост прежней,
 *  более длинной версии: без этого он оставался в облаке навсегда, и восстановление
 *  видело смесь версий («Mixed version stamps») и отказывалось собирать запись. */
export async function deleteLocalStorePagedRecords(userId: string, store: string, key: string, keepPages?: number): Promise<void> {
  let stale: string[] | null = null;
  if (keepPages !== undefined) {
    const { data, error } = await getSupabase()
      .from('local_store_records')
      .select('key')
      .eq('user_id', userId)
      .eq('store', store)
      .like('key', likePrefix(key));
    if (error != null) throw error;
    stale = ((data ?? []) as Array<{ key: string }>)
      .map(r => r.key)
      .filter(k => Number(k.slice(key.length + 1)) >= keepPages);
    if (stale.length === 0) return;
  }
  let q = getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId)
    .eq('store', store);
  q = stale ? q.in('key', stale) : q.like('key', likePrefix(key));
  const { error } = await q;
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

/** Число ЗАПИСЕЙ хранилищ в облаке без выкачивания строк — см. `countSummaries`.
 *  Запись длиннее порога лежит страницами `key#N`, и номер страницы открыт в
 *  payload: в счёт идёт нулевая страница либо запись без страниц, иначе одна
 *  длинная запись считалась бы восемью. */
export async function countLocalStoreRecords(userId: string, stores: readonly string[]): Promise<number> {
  const { count, error } = await getSupabase()
    .from('local_store_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('store', stores)
    .or('payload->>page.is.null,payload->>page.eq.0');
  if (error != null) throw error;
  if (count == null) throw new Error('COUNT_UNAVAILABLE: local_store_records');
  return count;
}
