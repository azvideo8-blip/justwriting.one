import { getSupabase } from '../supabase/client';
import { reportError } from '../../shared/errors/reportError';

/**
 * Флаги этапов SYNC1. RP-3 (практики ревью 24.10): выключатель живёт на сервере
 * (`public.feature_flags`, миграция 0046), а не константой в коде — выключить
 * новый путь можно одной строкой в базе, без выпуска. «Владельцу» = админ.
 *
 * Сбой чтения и сервер без 0046 — значение по умолчанию из кода, а не «включено»:
 * для синка это старый путь (класс «нет ответа ≠ нет»). Ответ кэшируется на сессию
 * и привязан к uid; долгоживущая вкладка увидит выключение после перезагрузки.
 */

/** S1-6: забор заметок «всё после серверного rev» вместо двух полных проходов.
 *  Выключено (или сервер без 0045) — старый путь, ровно как в 0.10.x:
 *  вход/сеть/сейф — только downloadAllFromCloud, видимость — checkAndSyncCursor
 *  (S1-13/S1-14). */
const SYNC_PULL_BY_REV_DEFAULT = false;

/** S2-4: запись ИИ-данных и прибавок счётчиков через `sync_push` (0047).
 *  Выключено, сервер без 0047 (PGRST202) или сбой чтения — старые пути записи. */
const SYNC_PUSH_RPC_DEFAULT = false;

const cached = new Map<string, { uid: string; value: boolean }>();
let pushUnavailableFor: string | null = null;

async function flagEnabled(flag: string, uid: string, fallback: boolean, action: string): Promise<boolean> {
  const hit = cached.get(flag);
  if (hit?.uid === uid) return hit.value;
  try {
    const { data, error } = await getSupabase().rpc('feature_enabled', { flag });
    if (error) throw error;
    // Ревью 0.11.0: кэшируется только ответ сервера. Сбой (офлайн-старт, обновление
    // токена) — старый путь на этот раз, следующий забор спросит снова.
    const value = data === true;
    cached.set(flag, { uid, value });
    return value;
  } catch (e) {
    reportError(e, { action, uid }, 'warning');
    return fallback;
  }
}

export async function syncPullByRevEnabled(uid: string): Promise<boolean> {
  return flagEnabled('sync_pull_by_rev', uid, SYNC_PULL_BY_REV_DEFAULT, 'featureFlag_syncPullByRev');
}

export async function syncPushRpcEnabled(uid: string): Promise<boolean> {
  if (pushUnavailableFor === uid) return false;
  return flagEnabled('sync_push_rpc', uid, SYNC_PUSH_RPC_DEFAULT, 'featureFlag_syncPushRpc');
}

/** S2-4: сервер ответил «функции нет» (PGRST202) — до конца сессии старые пути. */
export function markSyncPushUnavailable(uid: string): void {
  pushUnavailableFor = uid;
}

/** Только для тестов: сбросить кэш флага между сценариями. */
export function resetSyncFlagsForTests(): void {
  cached.clear();
  pushUnavailableFor = null;
}
