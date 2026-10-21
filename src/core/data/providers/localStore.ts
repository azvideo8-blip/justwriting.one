import { getSupabase } from '../../supabase/client';
import { ProviderRecord, LocalStoreRecordRow, ConditionalScalarWrite } from '../types';
import { likeGlob, likePrefix } from './fields';
import { pageAll, ownRows, ownRow } from './pageAll';

/**
 * Разбор серверной отметки `stamped_at` (миграция 0037):
 * PostgREST отдаёт timestamptz строкой ISO-8601, в тестах/моках может прийти числом.
 */
export function parseStampedAt(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const ms = Date.parse(val);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

/** T-8: единый маппер строки local_store_records с пробросом stamped_at (мс). */
export function rowToLocalStoreRecord(row: Record<string, unknown>): LocalStoreRecordRow {
  const rec: LocalStoreRecordRow = {
    store: row.store as string,
    key: row.key as string,
    payload: (row.payload ?? {}) as ProviderRecord,
  };
  if (typeof row.checksum === 'string') rec.checksum = row.checksum;
  const stamped = parseStampedAt(row.stamped_at);
  if (stamped !== undefined) rec.stamped_at = stamped;
  return rec;
}

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

/**
 * S0-1 (F-1): запись скалярной строки с условием на СЕРВЕРНУЮ отметку той
 * версии, от которой получена локальная копия. Слепой `upsert` всего ряда
 * тихо стирал правку второго устройства: здесь ряд не принимается, если с
 * момента нашей базы его кто-то переставлял (триггер `0037` делает это на
 * любом insert/update), — вызывающий перечитывает облако и решает спор.
 *
 * Почему не буквальное `.eq('stamped_at', iso)` из тикета: `stamped_at` —
 * `timestamptz` с микросекундами, а локальная база хранит миллисекунды
 * (`parseStampedAt` округляет вниз). Точное равенство усечённым литералом не
 * совпало бы ни с одной реальной строкой, и CAS отваливал бы каждую выгрузку.
 *
 * SF-6: окно — ОТ ТОЙ ЖЕ МИЛЛИСЕКУНДЫ И ДО НЕЙ ВКЛЮЧИТЕЛЬНО
 * (`.gte(база).lt(база+1мс)`), а не только верхняя граница. Один `lt` пропускал и
 * ряд СТАРШЕ базы: серверные часы отвели назад, или транзакция, начатая раньше,
 * закоммитилась позже — и условная запись перетирала версию, которой устройство не
 * видело, ровно тем жестом, который должен был этого запретить.
 * Ложных отказов не добавилось: строка, принятая в той же миллисекунде, что и наша
 * усечённая база, по-прежнему проходит (`>=` ей выполняется).
 */
export async function saveLocalStoreRecordIfUnstamped(
  userId: string,
  store: string,
  key: string,
  payload: ProviderRecord,
  baseStampedAt: number | null,
): Promise<ConditionalScalarWrite> {
  if (baseStampedAt === null) {
    // Базы нет: строки в облаке не было. insert вместо upsert — кто-то успел
    // создать ряд, это 23505 (конфликт), а не «перезаписать чужое».
    const { data, error } = await getSupabase()
      .from('local_store_records')
      .insert({ user_id: userId, store, key, payload, checksum: null })
      .select('stamped_at')
      .maybeSingle();
    if (error != null) {
      if ((error as { code?: string }).code === '23505') return { written: false };
      throw error;
    }
    return { written: true, stampedAt: parseStampedAt((data as Record<string, unknown> | null)?.stamped_at) ?? null };
  }
  /*gate:clock-rule*/
  // Участок правила спора копий: здесь запрещено читать часы устройства
// (`Date.now()`, `new Date()` без аргумента). Гейт — src/test/syncRuleGates.s06.test.ts (S0-6).
  const { data, error } = await getSupabase()
    .from('local_store_records')
    .update({ payload, checksum: null })
    .eq('user_id', userId)
    .eq('store', store)
    .eq('key', key)
    .gte('stamped_at', new Date(baseStampedAt).toISOString())
    .lt('stamped_at', new Date(baseStampedAt + 1).toISOString())
  /*endgate:clock-rule*/
    .select('stamped_at')
    .maybeSingle();
  if (error != null) throw error;
  if (data == null) return { written: false };
  return { written: true, stampedAt: parseStampedAt((data as Record<string, unknown>).stamped_at) ?? null };
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

export async function getLocalStoreRecord(userId: string, store: string, key: string): Promise<LocalStoreRecordRow | null> {
  const { data, error } = await getSupabase()
    .from('local_store_records')
    .select('*')
    .eq('user_id', userId)
    .eq('store', store)
    .eq('key', key)
    .maybeSingle();
  if (error != null) throw error;
  if (!ownRow(data, userId)) return null;
  return rowToLocalStoreRecord(data as Record<string, unknown>);
}

/** S-49: страницы записи — строки `key#…` (оба формата: `key#N` и `key#stamp#N`). */
export async function getLocalStoreRecordPages(userId: string, store: string, key: string): Promise<LocalStoreRecordRow[]> {
  const rows = await pageAll((from, to) => getSupabase()
    .from('local_store_records')
    .select('*')
    .eq('user_id', userId)
    .eq('store', store)
    .like('key', likePrefix(key))
    .order('key', { ascending: true })
    .range(from, to));
  return ownRows(rows as Record<string, unknown>[], userId).map(row => rowToLocalStoreRecord(row as Record<string, unknown>));
}

/** M-5: дочерние строки записи по префиксу ключа — сегменты диалога `key@seg…`.
 *  Отдельный метод, а не расширение getLocalStoreRecordPages: тот ищет только «#»,
 *  и его гранулярность завязана на форматы, которые читают 0.9.28/0.9.29. */
export async function getLocalStoreRecordsByKeyPrefix(userId: string, store: string, prefix: string): Promise<LocalStoreRecordRow[]> {
  const rows = await pageAll((from, to) => getSupabase()
    .from('local_store_records')
    .select('*')
    .eq('user_id', userId)
    .eq('store', store)
    .like('key', likeGlob(prefix))
    .order('key', { ascending: true })
    .range(from, to));
  return ownRows(rows as Record<string, unknown>[], userId).map(row => rowToLocalStoreRecord(row as Record<string, unknown>));
}

/** M-5: снести ровно названные строки — осиротевшие сегменты, которые head больше
 *  не перечисляет. Пустой список — ноль запросов: `.in('key', [])` под PostgREST
 *  сносит условие, а не выбирает «ничего». */
export async function deleteLocalStoreRecordsByKeys(userId: string, store: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { error } = await getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId)
    .eq('store', store)
    .in('key', keys);
  if (error != null) throw error;
}

/** T-8: только ключи и серверные отметки строк — без нагрузки. Для «Отправить всё». */
export async function getLocalStoreStamps(userId: string): Promise<Array<{ store: string; key: string; stamped_at?: number }>> {
  const rows = await pageAll((from, to) => getSupabase()
    .from('local_store_records')
    .select('store,key,stamped_at,user_id')
    .eq('user_id', userId)
    .order('store', { ascending: true })
    .order('key', { ascending: true })
    .range(from, to));
  return ownRows(rows as Record<string, unknown>[], userId).map(r => {
    const out: { store: string; key: string; stamped_at?: number } = { store: r.store as string, key: r.key as string };
    const stamp = parseStampedAt(r.stamped_at);
    if (stamp !== undefined) out.stamped_at = stamp;
    return out;
  });
}

export async function getLocalStoreRecords(userId: string, store?: string, sinceMs?: number): Promise<LocalStoreRecordRow[]> {
  const allRows = await pageAll((from, to) => {
    let q = getSupabase()
      .from('local_store_records')
      .select('*')
      .eq('user_id', userId);
    if (store) {
      q = q.eq('store', store);
    }
    // V-4.2 / W-3: инкрементальный забор сравнивает СЕРВЕРНУЮ отметку строки
    // (миграция 0037), а не `payload.updatedAt` — для всех сторов. Триггер
    // переставляет stamped_at на ЛЮБОМ insert/update, поэтому строка попадает в
    // выборку в тот момент, когда её принял сервер, а не когда её нарисовали часы
    // писателя: устройство, отстающее на два часа, больше не прячет свою правку
    // от остальных устройств на два часа. Раньше ветка по stamped_at выбиралась
    // только для store === 'aiDialogues', а единственный инкрементальный
    // вызывающий (AIRestoreService) передаёт store = undefined, — на проде она не
    // исполнялась вовсе.
    if (sinceMs !== undefined) {
      q = q.gt('stamped_at', new Date(Math.floor(sinceMs)).toISOString());
    }
    // R4-7: ключ уникален только внутри store (PK — user_id, store, key); без
    // store в сортировке одинаковые ключи разных сторов переставлялись между
    // страницами, и пагинация теряла или дублировала строки.
    return q
      .order('store', { ascending: true })
      .order('key', { ascending: true })
      .range(from, to);
  });
  return ownRows(allRows as Record<string, unknown>[], userId).map(row => rowToLocalStoreRecord(row as Record<string, unknown>));
}

export async function deleteLocalStoreRecord(userId: string, store: string, key: string): Promise<void> {
  const { error: err1 } = await getSupabase()
    .from('local_store_records')
    .delete()
    .eq('user_id', userId)
    .eq('store', store)
    .eq('key', key);
  if (err1 != null) throw err1;

  for (const sep of ['#', '@']) {
    const { error } = await getSupabase()
      .from('local_store_records')
      .delete()
      .eq('user_id', userId)
      .eq('store', store)
      .like('key', likeGlob(`${key}${sep}`));
    if (error != null) throw error;
  }
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
    // D-10: страниц записи бывает больше одной страницы PostgREST; без pageAll
    // хвост прежней версии оставался в облаке навсегда.
    // D-10: страниц записи бывает больше одной страницы PostgREST; без pageAll
    // хвост прежней версии оставался в облаке навсегда.
    const rows = await pageAll((from, to) => getSupabase()
      .from('local_store_records')
      .select('key')
      .eq('user_id', userId)
      .eq('store', store)
      .like('key', likePrefix(key))
      .order('key', { ascending: true })
      .range(from, to));
    stale = (rows as Array<{ key: string }>)
      .map(r => r.key)
      .filter(k => Number(k.slice(key.length + 1)) >= keepPages);
    if (stale.length === 0) return;
  }
  if (stale) {
    // Батчами: тысячи ключей в одном `in()` дают URL длиннее лимита nginx.
    for (let i = 0; i < stale.length; i += 100) {
      const { error } = await getSupabase()
        .from('local_store_records')
        .delete()
        .eq('user_id', userId)
        .eq('store', store)
        .in('key', stale.slice(i, i + 100));
      if (error != null) throw error;
    }
    return;
  }
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

/** Число ЗАПИСЕЙ хранилищ в облаке без выкачивания строк — см. `countSummaries`.
 *  Запись длиннее порога лежит страницами `key#N`, и номер страницы открыт в
 *  payload: в счёт идёт нулевая страница либо запись без страниц, иначе одна
 *  длинная запись считалась бы восемью. S-49: у постраничного диалога страницы
 *  `key#stamp#N` и манифест без номера страницы — считается манифест. */
export async function countLocalStoreRecords(userId: string, stores: readonly string[]): Promise<number> {
  const { count, error } = await getSupabase()
    .from('local_store_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('store', stores)
    .or('payload->>page.is.null,and(payload->>page.eq.0,key.not.like.%#%#%)');
  if (error != null) throw error;
  if (count == null) throw new Error('COUNT_UNAVAILABLE: local_store_records');
  return count;
}
