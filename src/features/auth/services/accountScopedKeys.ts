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
    // черновик письма и надгробие удаления (STORAGE_KEYS.DRAFT / DRAFT_DELETED)
    `draft-${uid}`,
    `draft-deleted-${uid}`,
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
    // отложенные ключи сейфа (AuthService)
    `pending_keys_${uid}`,
    // кэш психологического портрета (AIProfileService.portraitCacheKey).
    // Самый чувствительный единичный артефакт в приложении: спецкатегории и
    // имена третьих лиц открытым текстом.
    `ai_user_portrait_${uid}`,
    // кэш его разделов — вторая копия того же текста
    `ai_portrait_sections_${uid}`,
    // незавершённые сессии письма (STORAGE_KEYS.PENDING_SESSIONS)
    `pending_sessions_${uid}`,
  ];
}

export function accountScopedSessionStorageKeys(uid: string): string[] {
  return [
    `pending_keys_${uid}`,
    `jw_other_user_dismissed_${uid}`,
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
  'onboarding_done',
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
    if (middle.length > 0 && middle !== uid) return true;
  }
  return false;
}

/** Удаляет все ключи текущего аккаунта из localStorage/sessionStorage. */
export function clearAccountScopedStorage(uid: string | null | undefined): void {
  if (!uid) return;
  try {
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
  } catch {
    /* ignore */
  }
}
