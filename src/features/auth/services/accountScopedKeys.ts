// Ключи localStorage, которые принадлежат одному аккаунту и стираются вместе
// с ним при выходе «на чужом компьютере». Человеку в диалоге выхода показано
// число ЕГО записей — стирать чужие ключи заодно значит обещать больше, чем
// сделано. Ключи без привязки к аккаунту (тема, язык, аналитика) остаются:
// они не про данные человека.
//
// Список должен покрывать семью ключей, а не отдельных представителей: новый
// пер-аккаунтный ключ добавляется сюда И в тест
// accountScopedKeys.test.ts (инвентаризация по grep).

export function accountScopedLocalStorageKeys(uid: string): string[] {
  return [
    // сейф и его состояние (STORAGE_KEYS.ENC_ENABLED)
    `enc_enabled_${uid}`,
    // черновик письма (STORAGE_KEYS.DRAFT)
    `draft-${uid}`,
    // согласия и версии (PrivacyModal, core/ai/indexingConsent)
    `privacy_accepted_${uid}`,
    `ai_indexing_consent_${uid}`,
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
    // флаг завершения миграции legacy IndexedDB (LS-5)
    `jw_legacy_migrated_${uid}`,
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
    // экран выбора цели письма (AG-ONBOARD-1)
    `onboarding_done_${uid}`,
    // ожидающий подтверждения код восстановления и признак авто-создания сейфа (F-01)
    `pending_recovery_code_${uid}`,
    `vault_auto_created_${uid}`,
  ];
}

export function accountScopedSessionStorageKeys(uid: string): string[] {
  return [
    `pending_keys_${uid}`,
    `jw_other_user_dismissed_${uid}`,
    // надгробие удаления черновика сессии (STORAGE_KEYS.DRAFT_DELETED, LS-8)
    `draft-deleted-${uid}`,
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
  'app_language',
  'layout-mode',
  'layout-mode-v3',
  'preview_width',
  'ai_sidebar_width',
  'justwriting_sidebar_collapsed',
  'focus_swipe_hint_shown',
  'analytics_consent',
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
    localStorage.removeItem(key);
  }
}
