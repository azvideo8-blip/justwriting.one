/** Форма, а не зависимость: Firestore здесь больше нет, а пакет тянулся ради
 *  одного типа. Легаси-объект с seconds/nanoseconds приходит из старых
 *  экспортов; toDate опционален и вызывается утиной проверкой в dateUtils,
 *  поэтому пары seconds/nanoseconds из zod-схемы тип тоже покрывает. */
export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
  toDate?(): Date;
}
/** Локальный дубль удалённого `firebase/firestore.Timestamp`: только та часть
 *  формы, которую реально используют типы ниже. */
type Timestamp = TimestampLike;

export interface Label {
  id: string;
  name: string;
  color: string;
  // Имя не удалось расшифровать: показывается «…», а исходный шифротекст лежит
  // в _cipherName, чтобы обратная запись вернула его нетронутым. Без этого
  // любая правка списка меток затирала настоящие имена заглушками.
  _undecrypted?: boolean;
  _cipherName?: string;
}

export interface EncryptionMeta {
  salt: string;
  version: number;
  wrappedDataKey: string;
  verification: string;
  /** Тот же ключ данных, завёрнутый в код восстановления. Пусто у сейфов,
   *  заведённых до появления кода. */
  recoveryWrappedDataKey?: string | undefined;
  recoverySalt?: string | undefined;
  /** AUDIT-L7: PBKDF2-итерации при wrap; отсутствует у старых сейфов. */
  iterations?: number | undefined;
}

export interface UserProfile {
  uid: string;
  email: string;
  nickname: string;
  role?: string | undefined;
  labels?: Label[] | undefined;
  earnedAchievements?: string[] | undefined;
  totalWordCount?: number | undefined;
  sessionsCount?: number | undefined;
  streakDays?: number | undefined;
  totalDuration?: number | undefined;
  avgWpm?: number | undefined;
  avgSessionWords?: number | undefined;
  encryptionSalt?: string | undefined;
  encryptedDataKey?: string | undefined;
  encryptionMeta?: EncryptionMeta | undefined;
  /** null — колонка в базе пуста: политика не принята. Разбор профиля отдаёт
   *  именно null, а не отсутствие поля, и потребители это уже проверяют. */
  privacyAcceptedAt?: Timestamp | TimestampLike | Date | number | null | undefined;
  /** Согласие на обработку специальных категорий (ст. 10 152-ФЗ). Даётся и
   *  отзывается отдельно от согласия с политикой. */
  aiConsentAt?: Timestamp | TimestampLike | Date | number | null | undefined;
  aiConsentVersion?: number | null | undefined;
  /** D4.27: Согласие на векторную индексацию (поиск по смыслу).
   *  Отправка фрагментов заметок в модель эмбеддингов. */
  indexingConsentAt?: Timestamp | TimestampLike | Date | number | null | undefined;
  indexingConsentVersion?: number | null | undefined;
  /** Tombstone-момент сброса достижений (#100): merge с другого устройства
   *  не воскрешает ачивки, заработанные раньше этой метки. */
  achievementsResetAt?: Timestamp | TimestampLike | Date | number | null | undefined;
  privacyVersion?: number | undefined;
  aiPortrait?: string | undefined;
  _encrypted?: boolean | undefined;
}

export type AchievementTier = 'common' | 'rare' | 'legendary';

export interface Achievement {
  id: string;
  title: string;
  icon: string;
  threshold: number;
  tier: AchievementTier;
}

export interface SessionCore {
  userId: string;
  authorName?: string | undefined;
  authorPhoto?: string | undefined;
  nickname?: string | undefined;
  title?: string | undefined;
  content: string;
  duration: number;
  wordCount: number;
  charCount: number;
  wpm: number;
  isPublic?: boolean | undefined;
  tags?: string[] | undefined;
  mood?: string | undefined;
}

export interface Session extends SessionCore {
  id: string;
  labelId?: string | undefined;
  sessionStartTime?: number | null | undefined;
  createdAt: Timestamp | Date | number;
  /** Слова именно этой сессии (дельта последней версии), а не объём всей
   *  заметки: heatmap и стрик красят день работой этого дня (#101). */
  sessionWordsAdded?: number | undefined;
  _isLocal?: boolean | undefined;
  _isLegacy?: boolean | undefined;
  _hasCloudCopy?: boolean | undefined;
  _aiProcessed?: boolean | undefined;
  _aiAction?: string | undefined;
  _aiProcessedAt?: number | string | null | undefined;
  _aiResultText?: string | undefined;
  excludedFromAI?: boolean | undefined;
}

export interface SessionPayload extends SessionCore {
  pinnedThoughts?: string[] | undefined;
  sessionType?: 'free' | 'stopwatch' | 'timer' | 'words' | 'finish-by' | undefined;
  sessionStartTime?: number | null | undefined;
  goalReached?: boolean | undefined;
  updatedAt?: Timestamp | Date | number | undefined;
}

// AUDIT-part2 4.2: канонические поля документа — единый источник истины для
// LocalDocument (core/storage/localDb) и Document (облачная форма). Время
// параметризовано сознательно: локальный стор хранит ms-числа, облако —
// Date|null; унифицировать рантайм нельзя, но дрейф скалярных полей теперь
// ловит компилятор: новое общее поле добавляется СЮДА и обязано появиться
// в обеих сторонах (и в маппере core/services/mappers.ts) сразу.
export interface DocumentFields<TTime> {
  title?: string | undefined;
  currentVersion: number;
  totalWords: number;
  totalDuration: number;
  sessionsCount: number;
  firstSessionAt: TTime;
  lastSessionAt: TTime;
  isPublic?: boolean | undefined;
  tags?: string[] | undefined;
  labelId?: string | undefined;
  mood?: string | undefined;
  excludedFromAI?: boolean | undefined;
}

export interface Document extends DocumentFields<Date | null> {
  id: string;
  uuid?: string | undefined;
  userId: string;
  _locked?: boolean | undefined;
  _decryptionError?: boolean | undefined;
  deletedAt?: Date | null | undefined;
}

export interface Version {
  id: string;
  documentId: string;
  userId: string;
  version: number;
  content: string;
  wordCount: number;
  wordsAdded: number;
  charsAdded: number;
  duration: number;
  wpm: number;
  goalWords?: number | undefined;
  goalTime?: number | undefined;
  goalReached?: boolean | undefined;
  savedAt: Date | null;
  sessionStartedAt: Date | null;
  mood?: string | undefined;
  /** Запись не прошла zod-валидацию и собрана из проверенных полей вручную.
   *  Версию видно и она восстановима, но доверять метрикам в ней нельзя. */
  _degraded?: boolean | undefined;
}

/**
 * Сессия с пометками состояния синхронизации и читаемости.
 *
 * Живёт в shared, а не в features/archive: этот же тип нужен чату (превью
 * цитаты), экспорту и архиву. Пока он лежал в фиче, каждый его потребитель
 * оказывался cross-feature импортом — храповик границ ловил ровно это.
 */
export interface ArchiveSession extends Session {
  _linkedCloudId?: string | undefined;
  _hasCloudCopy?: boolean | undefined;
  _isLegacy?: boolean | undefined;
  _hasPendingSync?: boolean | undefined;
  _locked?: boolean | undefined;
  _decryptionError?: boolean | undefined;
  _contentError?: boolean | undefined;
  // Cloud-only note whose text the list view did not fetch. Not the same as an
  // empty note — load it before showing or exporting.
  _contentNotLoaded?: boolean | undefined;
}
