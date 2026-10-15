// S-44.4: срок жизни гостевого черновика — один для слоя письма (GuestDraftService)
// и для переноса в аккаунт (auth/migrateDocuments): auth не может импортировать writing.
export const GUEST_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const STORAGE_KEYS = {
  GUEST_ID: 'jw_guest_id',
  GUEST_DRAFT: 'jw_guest_draft',
  DRAFT: (userId: string) => `draft-${userId}`,
  DRAFT_DELETED: (userId: string) => `draft-deleted-${userId}`,
  APP_LANGUAGE: 'app_language',
  APP_THEME: 'app-theme',
  FOCUS_SWIPE_HINT_SHOWN: 'focus_swipe_hint_shown',
  ENC_ENABLED: (userId: string) => `enc_enabled_${userId}`,
  UNLOCKED_ACHIEVEMENTS: (uid: string) => `unlocked_achievements_${uid}`,
  WORD_GOAL: (uid: string) => `word_goal_${uid}`,
  LOCAL_SESSION: (ts: number, uuid: string) => `local_session_${ts}_${uuid}`,
  LOCAL_SESSION_PREFIX: 'local_session_',
  PREVIEW_WIDTH: 'preview_width',
  ZEN_MODE_ENABLED: 'v2_zenModeEnabled',
  PENDING_KEYS: (uid: string) => `pending_keys_${uid}`,
  ENCRYPTION_MIGRATION_CHECKPOINT: (userId: string) => `encryptionMigration_${userId}_checkpoint`,
  AI_LIMIT: (uid?: string | null) => (uid ? `jw_ai_daily_usage_${uid}` : 'ai_daily_usage_guest'),
  GUEST_AI_DAILY_USAGE: 'ai_daily_usage_guest',
  LEGACY_AI_DAILY_USAGE: 'ai_daily_usage',
  AI_DAILY_USAGE: 'ai_daily_usage',
  AI_DAILY_REMAINING: 'ai_daily_remaining',
  AUTO_SYNC_ENABLED: (uid: string) => `auto_sync_enabled_${uid}`,
  AUTO_SYNC_ASKED: (uid: string) => `auto_sync_asked_${uid}`,
  LEGACY_AUTO_SYNC_ENABLED: 'auto_sync_enabled',
  LEGACY_AUTO_SYNC_ASKED: 'auto_sync_asked',
  DIAGNOSTICS_UNLOCKED: 'diagnostics_unlocked',
  PRIVACY_ACCEPTED: (uid: string) => `privacy_accepted_${uid}`,
  STREAK_FREEZES: (userId?: string | null) => (userId ? `jw_streak_freezes_${userId}` : 'jw_streak_freezes_guest'),
  GUEST_STREAK_FREEZES: 'jw_streak_freezes_guest',
  LEGACY_STREAK_FREEZES: 'jw_streak_freezes',
  MIGRATION_DECLINED: (uid: string) => `jw_migration_declined_${uid}`,
  DICTATION_NOTICE_SEEN: 'jw_dictation_notice_seen',
  // D-5: текст предупреждения изменился по существу (второй хоп — текст в ИИ-сервис),
  // поэтому показываем его ещё раз тем, кто принял v1.
  DICTATION_NOTICE_SEEN_V2: 'jw_dictation_notice_seen_v2',
  /** MF-5: «Больше не показывать» в листе «Голосовой ввод» на телефоне — по человеку. */
  DICTATION_NOTICE_DISMISSED: (uid: string) => `jw_dictation_notice_dismissed_${uid}`,
  PENDING_RECOVERY_CODE: (uid: string) => `pending_recovery_code_${uid}`,
  /** V-1.1: шаг мастера приглашения по хэшу токена из ссылки (sessionStorage). */
  INVITE_WIZARD_STATE: (tokenHash: string) => `jw_invite_wizard_${tokenHash}`,
  /** Когда этот аккаунт вышел сознательно (в любой вкладке) — N-60. */
  VOLUNTARY_SIGNOUT_AT: (uid: string) => `jw_voluntary_signout_at_${uid}`,
  /** S-28: uid аккаунта, сессия которого оборвалась не по воле человека. */
  LOST_SESSION_UID: 'jw_lost_session_uid',
  VAULT_AUTO_CREATED: (uid: string) => `vault_auto_created_${uid}`,
  VAULT_AUTO_UNLOCK_FAILED: (uid: string) => `vault_auto_unlock_failed_${uid}`,
  // X-5: поколение векторного индекса — общее для вкладок, см. embeddingIndexCache.
  EMB_INDEX_GEN: 'jw_emb_index_gen',
} as const;

