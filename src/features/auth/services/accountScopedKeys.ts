// Ключи localStorage, которые принадлежат одному аккаунту и стираются вместе
// с ним при выходе «на чужом компьютере». Человеку в диалоге выхода показано
// число ЕГО записей — стирать чужие ключи заодно значит обещать больше, чем
// сделано. Ключи без привязки к аккаунту (тема, язык, аналитика) остаются:
// они не про данные человека.
//
// Список должен покрывать семью ключей, а не отдельных представителей: новый
// пер-аккаунтный ключ добавляется сюда И в тест
// accountScopedKeys.test.ts (инвентаризация по grep).

import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

export function accountScopedLocalStorageKeys(uid: string): string[] {
  return [
    // сейф и его состояние (STORAGE_KEYS.ENC_ENABLED)
    `enc_enabled_${uid}`,
    // черновик письма (STORAGE_KEYS.DRAFT)
    `draft-${uid}`,
    // AP2-4: надгробие удалённого черновика и недосланное облачное удаление
    `draft-deleted-persistent-${uid}`,
    `draft-delete-pending-${uid}`,
    // согласия и версии (PrivacyModal, core/ai/indexingConsent)
    `privacy_accepted_${uid}`,
    `ai_indexing_consent_${uid}`,
    `ai_indexing_consent_v2_${uid}`,
    // достижения (Achievements, ProfilePage)
    `unlocked_achievements_${uid}`,
    `achievement_earned_at_${uid}`,
    `achievements_reset_at_${uid}`,
    // заморозки серий (streakFreeze, S-19)
    `jw_streak_freezes_${uid}`,
    // чекпоинт миграции шифрования (encryptMigration.getCheckpointKey)
    `encryptionMigration_${uid}_checkpoint`,
    // подсказка «восстановить из облака» (useEmptyDeviceDetection)
    `jw_restore_prompt_dismissed_${uid}`,
    // RA1-7: «В этот день» закрыт на сегодня (дата, не id заметки)
    `onthisday_dismissed_${uid}`,
    // «Продолжить» скрыта на сегодня (дата)
    `home_return_dismissed_${uid}`,
    // кэш психологического портрета (AIProfileService.portraitCacheKey).
    // Самый чувствительный единичный артефакт в приложении: спецкатегории и
    // имена третьих лиц открытым текстом.
    `ai_user_portrait_${uid}`,
    // кэш его разделов — вторая копия того же текста
    `ai_portrait_sections_${uid}`,
    // таксономия и лог судьи граней AI (LS-1)
    `ai_taxonomy_${uid}`,
    `ai_judge_log_${uid}`,
    // троттлинг проверки облака при восстановлении (LS-3)
    `last_restore_listing_ts_${uid}`,
    // согласие и запрос облачной синхронизации (LS-2)
    `auto_sync_enabled_${uid}`,
    `auto_sync_asked_${uid}`,
    // дневной лимит AI (LS-5)
    `jw_ai_daily_usage_${uid}`,
    // отказ от миграции гостя (LS-5)
    `jw_migration_declined_${uid}`,
    // отправка портрета в диалог AI (LS-5)
    `ai_send_portrait_in_dialogue_${uid}`,
    // дата завершения фонового восстановления заметок и AI (LS-5)
    `ai_restore_done_date_${uid}`,
    // Журнал владельца 30.10: пауза после неудачного полного прохода ИИ-данных.
    `ai_restore_retry_after_${uid}`,
    // C2: то же для заметок отдельно
    `notes_restore_done_date_${uid}`,
    // флаг завершения миграции legacy IndexedDB (LS-5)
    `jw_legacy_migrated_${uid}`,
    // R-11 (LG-1): документ аккаунта застрял в общей базе после миграции — сигнал дан
    `jw_shared_db_stuck_${uid}`,
    // CK-1: последнее измеренное расхождение часов устройства и сервера (секунды).
    // Нужно, чтобы страница, открытая заново после выхода, знала причину: выход из-за
    // просроченного по часам токена иначе выглядит как «сессию отозвали, сотри данные».
    `jw_clock_skew_${uid}`,
    // кэш анализа коммуникативных дверей (LS-5)
    `contact_doors_cache_${uid}`,
    // кэш облака слов архива (LS-5)
    `cached_word_cloud_v2:${uid}`,
    `cached_word_cloud_v2:${uid}:timestamp`,
    // курсор изменений синхронизации (LS-5)
    `change_cursor_last_seen_${uid}`,
    // запрос и курсор восстановления эмбеддингов (LS-4)
    `ai_embed_restore_requested_${uid}`,
    `ai_embed_restore_cursor_${uid}`,
    // П-6: догрузка начиналась / завершена — по аккаунту, иначе выход одного
    // человека снимал бы троттлинг другого
    `ai_embed_restore_started_${uid}`,
    `ai_embed_restore_done_${uid}`,
    // В-1: сколько проходов подряд курсор догрузки не сдвинулся
    `ai_embed_restore_stall_${uid}`,
    // ожидающий подтверждения код восстановления и признак авто-создания сейфа (F-01)
    `pending_recovery_code_${uid}`,
    `vault_auto_created_${uid}`,
    // сохранённая цель по словам (D-19)
    `word_goal_${uid}`,
    // «Больше не показывать» листа «Голосовой ввод» (MF-5)
    `jw_dictation_notice_dismissed_${uid}`,
    // R7F-015: сам факт, что предупреждение о диктовке показано, — тоже по
    // аккаунту: на втором человеке оно обязано появиться заново.
    `jw_dictation_notice_seen_v2_${uid}`,
    // R7F-015: сам факт, что предупреждение о диктовке показано, — тоже по
    // аккаунту: на втором человеке оно обязано появиться заново.

    // отметка инкрементального забора данных ИИ с других устройств
    `ai_pull_since_${uid}`,
    // DE-2: сколько проходов осиротевший head диалога уже держит курсор забора
    `ai_incomplete_holds_${uid}`,
    // выключатель подсказок и памяти ИИ (EA-18)
    `ai_chat_extras_${uid}`,
    // отметки «слишком большая для облака» запись ИИ-стора — на учётку (L-4, R4-017)
    `ai_sync_oversized_records:${uid}`,
    // S0-2 (F-3): журналы ИИ-синка переехали на ключ учётки, поэтому СВОЙ ключ
    // сносится целиком, а чужой защищается по форме: belongsToAnotherAccount
    // выводит семейства из этого списка. Общие ключи прежней формы живут один
    // релиз (перенос их не удаляет) — для них остаётся вырезание своих строк.
    `sync_pending_duration:${uid}`,
    `ai_sync_pending_deletes:${uid}`,
    `ai_sync_pending_upserts:${uid}`,
    `ai_sync_dead_upserts:${uid}`,
    `ai_sync_pending_analysis_deletes:${uid}`,
    // отметка сознательного выхода — гасит ложное «сессия оборвалась» (N-60)
    `jw_voluntary_signout_at_${uid}`,
    // R7F-020: очередь theme-касалок. Прежний общий ключ подметание сносило
    // выходом любого аккаунта, а делить его записи по uid нечем; ключ переехал на
    // ключ по аккаунту.
    `jw_pending_theme_touches_${uid}`,
  ];
}

export function accountScopedSessionStorageKeys(uid: string): string[] {
  return [
    `pending_keys_${uid}`,
    `jw_other_user_dismissed_${uid}`,
    // надгробие удаления черновика сессии (STORAGE_KEYS.DRAFT_DELETED, LS-8)
    `draft-deleted-${uid}`,
    `vault_auto_unlock_failed_${uid}`,
  ];
}

/**
 * Настройки устройства — единственное, что переживает «стереть всё с этого
 * компьютера». Это не данные человека: тема, язык, ширина панели, показанные
 * подсказки.
 *
 * Список перевёрнут намеренно. Раньше перечислялось то, что стирать, — и он
 * дважды разошёлся с приложением: кэш портрета со спецкатегориями и кэш его
 * разделов лежали под общими ключами и переживали выход, а объявленный список
 * про них не знал. Перечень стираемого не может быть полным по построению:
 * забытый ключ означает оставшиеся данные. Перечень сохраняемого ошибается в
 * другую сторону — забытая настройка просто сбросится.
 */
const DEVICE_SETTINGS_KEYS = new Set<string>([
  'app-theme',
  STORAGE_KEYS.APP_LANGUAGE,
  'layout-mode',
  'layout-mode-v3',
  // R7Q-026: живое поколение ключа. Выше перечислены мёртвые, а рабочего не
  // было — подметание сносило выбранный макет при выходе любого аккаунта.
  'layout-mode-v4',
  'preview_width',
  'ai_sidebar_width',
  'justwriting_sidebar_collapsed',
  // N1-3: `analytics_consent` здесь не стало. Это ключ PostHog-аналитики,
  // удалённой из приложения 619975e9 (20.09.2026, OUT-1..7 — вместе с
  // `src/core/analytics/analytics.ts`): в `src/` его никто не читает и не пишет,
  // а решение об ИИ хранится по аккаунту (`core/ai/aiConsent.ts`,
  // `privacy_accepted_${uid}`), не по устройству. Мёртвая строка в белом списке
  // только вечно берегла байт старой версии.
  'diagnostics_unlocked',
  'v2_zenModeEnabled',
]);

/**
 * Ключ, помеченный ЧУЖИМ идентификатором аккаунта. Второй человек этого
 * браузера в диалоге выхода не участвовал, и его сейф, черновики и согласия
 * стирать нельзя.
 *
 * Семейства выводятся из самого списка выше, а не описываются вторым перечнем:
 * иначе они разойдутся. Опознавать чужой ключ по ФОРМЕ идентификатора нельзя —
 * форма зависит от поставщика входа и однажды уже изменится.
 */
const UID_SENTINEL = '\u0000uid\u0000';

function accountKeyShapes(): { prefix: string; suffix: string }[] {
  const shapes: { prefix: string; suffix: string }[] = [];
  for (const template of accountScopedLocalStorageKeys(UID_SENTINEL)) {
    const at = template.indexOf(UID_SENTINEL);
    if (at < 0) continue;
    shapes.push({ prefix: template.slice(0, at), suffix: template.slice(at + UID_SENTINEL.length) });
  }
  return shapes;
}

function belongsToAnotherAccount(key: string, uid: string): boolean {
  for (const { prefix, suffix } of accountKeyShapes()) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const middle = key.slice(prefix.length, key.length - suffix.length);
    // LS-6: Ключи с псевдо-идентификатором гостя ('guest' или 'guest_...')
    // не принадлежат другому зарегистрированному аккаунту и должны стираться
    // при выходе «на чужом компьютере», а не защищаться от стирания.
    if (middle === 'guest' || middle.startsWith('guest_')) return false;
    if (middle.length > 0 && middle !== uid) return true;
  }
  return false;
}

/**
 * R7F-020: журналы ожидающей синхронизации лежат под ОДНИМ ключом на весь
 * браузер, а каждая запись в них подписана uid. Снести такой ключ выходом A —
 * значит стереть обязательства B: у него пропадали отложенные облачные удаления
 * (следующее восстановление возвращало в облако удалённый разбор) и долг секунд
 * за уже выгруженные ряды. Поэтому из журнала вырезается только uid уходящего
 * аккаунта.
 */
const UID_JOURNAL_KEYS = [
  'sync_pending_duration',
  'ai_sync_pending_deletes',
  'ai_sync_pending_upserts',
  'ai_sync_dead_upserts',
  'ai_sync_pending_analysis_deletes',
] as const;

function dropOwnJournalEntries(uid: string, key: string): void {
  const raw = localStorage.getItem(key);
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Нечитаемый журнал — это не чужие данные, а битые байты: сносим целиком.
    localStorage.removeItem(key);
    return;
  }
  if (!Array.isArray(parsed)) {
    localStorage.removeItem(key);
    return;
  }
  const kept = parsed.filter(entry => (entry as { uid?: unknown } | null)?.uid !== uid);
  if (kept.length === 0) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(kept));
}

/** Удаляет все ключи текущего аккаунта из localStorage/sessionStorage. */
export function clearAccountScopedStorage(uid: string | null | undefined): void {
  if (!uid) return;
  for (const key of accountScopedLocalStorageKeys(uid)) {
    localStorage.removeItem(key);
  }
  for (const key of accountScopedSessionStorageKeys(uid)) {
    sessionStorage.removeItem(key);
  }

  // Подметание: всё, что не объявлено настройкой устройства и не принадлежит
  // другому аккаунту, — данные этого человека.
  for (const key of Object.keys(localStorage)) {
    if (DEVICE_SETTINGS_KEYS.has(key)) continue;
    if (belongsToAnotherAccount(key, uid)) continue;
    if (key.startsWith('jw_pending_purge_')) continue;
    if ((UID_JOURNAL_KEYS as readonly string[]).includes(key)) {
      dropOwnJournalEntries(uid, key);
      continue;
    }
    localStorage.removeItem(key);
  }
}

/**
 * N-2: производные ИИ, закэшированные в localStorage (портрет, его разделы,
 * темы, журнал судьи). «Удалить все данные ИИ» чистило сервер и IndexedDB, а
 * портрет при пустой базе читался из этого кэша и возвращался в подсказки.
 */
export function clearAiDerivedLocalCaches(uid: string): void {
  for (const key of [
    `ai_user_portrait_${uid}`,
    `ai_portrait_sections_${uid}`,
    `ai_taxonomy_${uid}`,
    `ai_judge_log_${uid}`,
    'ai_user_portrait',
  ]) {
    try { localStorage.removeItem(key); } catch { /* намеренно: приватный режим — ключа и нет */ }
  }
}
