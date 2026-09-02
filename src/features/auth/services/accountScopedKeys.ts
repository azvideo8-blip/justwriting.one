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
  ];
}

export function accountScopedSessionStorageKeys(uid: string): string[] {
  return [
    `pending_keys_${uid}`,
    `jw_other_user_dismissed_${uid}`,
  ];
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
  } catch {
    /* ignore */
  }
}
