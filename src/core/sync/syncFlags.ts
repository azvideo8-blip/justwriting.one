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

const cached = new Map<string, { uid: string; value: boolean }>();

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

/**
 * Ответ по подборке записей, вторая версия (стенд ai-answer-chronicle-fable-2026-11):
 * второй кусок длинной заметки и правило ответа вне ограды данных. Выключено,
 * нет строки в `feature_flags`, гость или сбой чтения — ход идёт как в 0.11.10.
 */
export async function answerChronicleV2Enabled(uid: string | undefined): Promise<boolean> {
  if (!uid) return false;
  return flagEnabled('answer_chronicle_v2', uid, false, 'featureFlag_answerChronicleV2');
}

/**
 * Осторожная гипотеза в разговоре (стенд ai-hypotheses-fable-2026-11): записи
 * разных дней в ходе и правило гипотезы вне ограды данных. Выключено, нет строки
 * в `feature_flags`, гость или сбой чтения — ход идёт как в 0.11.16.
 */
export async function chatHypothesesEnabled(uid: string | undefined): Promise<boolean> {
  if (!uid) return false;
  return flagEnabled('chat_hypotheses', uid, false, 'featureFlag_chatHypotheses');
}

/**
 * DI-4…DI-8: выводы из разговоров (согласие репликой, кнопка, список в
 * профиле, вспоминание). Нет строки в `feature_flags`, гость или сбой чтения —
 * выключено: ход и экраны как в 0.11.22.
 */
export async function chatInsightsEnabled(uid: string | undefined): Promise<boolean> {
  if (!uid) return false;
  return flagEnabled('chat_insights', uid, false, 'featureFlag_chatInsights');
}

/**
 * Флаг `chat_persona_ta`: собеседник «Транзактный аналитик» виден в списке.
 * Нет строки, гость или сбой чтения — не виден; уже начатый с ним разговор
 * продолжается (собеседник встроенный, сервер его знает).
 */
export async function chatPersonaTaEnabled(uid: string | undefined): Promise<boolean> {
  if (!uid) return false;
  return flagEnabled('chat_persona_ta', uid, false, 'featureFlag_chatPersonaTa');
}

/** Только для тестов: сбросить кэш флага между сценариями. */
export function resetSyncFlagsForTests(): void {
  cached.clear();
}
