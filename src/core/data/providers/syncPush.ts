import { getSupabase } from '../../supabase/client';
import type { SyncPushItem, SyncPushResult } from '../types';

const STATUSES = new Set(['ok', 'conflict', 'duplicate', 'missing', 'gone', 'rejected']);

/**
 * S2-4: запись через `sync_push` (0047). Ответ разбирается строго: длина не равна
 * пачке или неизвестный статус — исключение, а не «легло». Запись подтверждается
 * ответом, а не отсутствием ошибки; таймаут/обрыв — «не знаю» у вызывающего.
 */
export async function syncPush(items: SyncPushItem[]): Promise<SyncPushResult[]> {
  if (items.length === 0) return [];
  const { data, error } = await getSupabase().rpc('sync_push', { items });
  if (error != null) throw error;
  if (!Array.isArray(data) || data.length !== items.length) {
    throw new Error(`sync_push: response of ${Array.isArray(data) ? data.length : typeof data} for ${items.length} items`);
  }
  for (const r of data as Array<Record<string, unknown> | null>) {
    if (r == null || typeof r.status !== 'string' || !STATUSES.has(r.status)) {
      throw new Error(`sync_push: unknown response ${JSON.stringify(r)}`);
    }
  }
  return data as SyncPushResult[];
}

/** Сервер без 0047: PostgREST не нашёл функцию. */
export function isSyncPushMissing(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'PGRST202';
}
