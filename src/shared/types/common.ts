import type { Timestamp } from 'firebase/firestore';

/** Время, как оно приходит из разбора профиля: Postgres отдаёт строку или
 *  число, а `firestoreTimestampSchema` допускает ещё и пару seconds/nanoseconds
 *  без методов firebase'ного `Timestamp`. Тип нужен, чтобы разобранный профиль
 *  ложился в `UserProfile` без приведения — приведение и скрывало полгода то,
 *  что схема теряет поля. */
export interface TimestampLike { seconds: number; nanoseconds: number }

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

export interface Document {
  id: string;
  uuid?: string | undefined;
  userId: string;
  title?: string | undefined;
  currentVersion: number;
  totalWords: number;
  totalDuration: number;
  sessionsCount: number;
  firstSessionAt: Date | null;
  lastSessionAt: Date | null;
  isPublic?: boolean | undefined;
  tags?: string[] | undefined;
  labelId?: string | undefined;
  mood?: string | undefined;
  excludedFromAI?: boolean | undefined;
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
}
