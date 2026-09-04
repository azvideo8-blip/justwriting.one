import { z } from 'zod';
import { toDate } from '../utils/dateUtils';

/**
 * Приводит любую форму облачной отметки времени к `Date | null`.
 *
 * `z.undefined()` в объединение НЕ добавляется намеренно: поля помечены
 * `.optional()`, и приняв undefined здесь, схема материализует отсутствующее
 * поле как `null`. Разобранный профиль, записанный обратно, тогда проставил бы
 * `aiConsentAt: null` там, где значения просто не было, — то есть отозвал бы
 * согласие артефактом разбора. Отсутствие обязано оставаться отсутствием.
 */
export const cloudTimestampSchema = z.union([
  z.object({ seconds: z.number(), nanoseconds: z.number() }),
  z.date(),
  z.number(),
  z.string(),
  z.null(),
]).transform(v => toDate(v));

export const labelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  _encrypted: z.boolean().optional(),
});

export const sessionDbSchema = z.object({
  id: z.string(),
  userId: z.string().default(''),
  content: z.string().default(''),
  title: z.string().default(''),
  wordCount: z.number().nonnegative().default(0),
  charCount: z.number().nonnegative().default(0),
  duration: z.number().nonnegative().default(0),
  wpm: z.number().nonnegative().default(0),
  tags: z.array(z.string()).default([]),
  pinnedThoughts: z.array(z.string()).default([]),
  isPublic: z.boolean().optional(),
  authorName: z.string().optional(),
  authorPhoto: z.string().optional(),
  nickname: z.string().optional(),
  labelId: z.string().nullable().optional(),
  createdAt: cloudTimestampSchema,
  sessionStartTime: z.number().nullable().optional(),
  _encrypted: z.boolean().optional(),
  _aiProcessed: z.boolean().optional(),
  _aiAction: z.string().optional(),
  _aiProcessedAt: cloudTimestampSchema.optional(),
  _aiResultText: z.string().optional(),
  mood: z.string().optional(),
  excludedFromAI: z.boolean().optional(),
});

export const encryptionMetaSchema = z.object({
  salt: z.string(),
  version: z.number().default(1),
  wrappedDataKey: z.string(),
  verification: z.string().default(''),
  // Zod по умолчанию выбрасывает поля, которых нет в схеме. Без этих двух
  // строк профиль в интерфейсе теряет признак кода восстановления, и плашка
  // «код восстановления не создан» висит над только что созданным кодом.
  recoveryWrappedDataKey: z.string().optional(),
  recoverySalt: z.string().optional(),
  // AUDIT-L7: число итераций PBKDF2 при wrap. У старых сейфов поля нет —
  // тогда работает legacy-перебор 600k/300k.
  iterations: z.number().optional(),
});

export const userProfileDbSchema = z.object({
  uid: z.string(),
  email: z.string().default(''),
  nickname: z.string().default('User'),
  role: z.enum(['admin', 'user']).optional(),
  encryptionSalt: z.string().optional(),
  encryptedDataKey: z.string().optional(),
  encryptionMeta: encryptionMetaSchema.optional(),
  earnedAchievements: z.array(z.string()).default([]),
  privacyAcceptedAt: cloudTimestampSchema.optional(),
  privacyVersion: z.number().optional(),
  aiConsentAt: cloudTimestampSchema.optional(),
  aiConsentVersion: z.number().nullable().optional(),
  indexingConsentAt: cloudTimestampSchema.optional(),
  indexingConsentVersion: z.number().nullable().optional(),
  achievementsResetAt: cloudTimestampSchema.optional(),
  aiPortrait: z.string().optional(),
  _encrypted: z.boolean().optional(),
  // Всё, что ниже, схема раньше не описывала — и разбор выбрасывал это из
  // профиля. Метки так исчезали из выбора при завершении письма.
  // `.catch` — не украшение: разбор профиля идёт целиком, и одна кривая метка
  // в jsonb уронила бы весь профиль в `null`, то есть «шифрование не
  // настроено» и заблокированный импорт. Пусть лучше пропадёт список меток.
  labels: z.array(labelSchema).optional().catch(undefined),
  totalWordCount: z.number().optional(),
  sessionsCount: z.number().optional(),
  streakDays: z.number().optional(),
  totalDuration: z.number().optional(),
  avgWpm: z.number().optional(),
  avgSessionWords: z.number().optional(),
});

export const documentDbSchema = z.object({
  id: z.string(),
  uuid: z.string().optional(),
  userId: z.string().default(''),
  title: z.string().optional(),
  currentVersion: z.number().nonnegative().default(0),
  totalWords: z.number().nonnegative().default(0),
  totalDuration: z.number().nonnegative().default(0),
  sessionsCount: z.number().nonnegative().default(0),
  tags: z.array(z.string()).optional(),
  labelId: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  firstSessionAt: cloudTimestampSchema,
  lastSessionAt: cloudTimestampSchema,
  mood: z.string().optional(),
  excludedFromAI: z.boolean().optional().default(false),
  _encrypted: z.boolean().optional(),
  _locked: z.boolean().optional(),
  _decryptionError: z.boolean().optional(),
  deletedAt: cloudTimestampSchema.optional(),
});

export const versionDbSchema = z.object({
  id: z.string().optional().default(''),
  documentId: z.string().default(''),
  userId: z.string().optional().default(''),
  version: z.number().nonnegative().default(0),
  content: z.string().default(''),
  wordCount: z.number().nonnegative().default(0),
  wordsAdded: z.number().nonnegative().default(0),
  charsAdded: z.number().nonnegative().default(0),
  duration: z.number().nonnegative().default(0),
  wpm: z.number().nonnegative().default(0),
  goalWords: z.number().nullable().optional(),
  goalTime: z.number().nullable().optional(),
  goalReached: z.boolean().default(false),
  savedAt: cloudTimestampSchema,
  sessionStartedAt: cloudTimestampSchema,
  _encrypted: z.boolean().optional(),
  mood: z.string().optional(),
});

export type SessionDb = z.infer<typeof sessionDbSchema>;
export type DocumentDb = z.infer<typeof documentDbSchema>;
export type VersionDb = z.infer<typeof versionDbSchema>;
export type EncryptionMetaDb = z.infer<typeof encryptionMetaSchema>;
export type UserProfileDb = z.infer<typeof userProfileDbSchema>;

// Облачный черновик проходит через эту схему до входа в таймеры/арифметику:
// слепой каст `as LocalDraft` пропускал битые типы (content: 42, updatedAt:
// строка) прямо в расчёт WPM и сравнения дат.
export const draftDbSchema = z.object({
  userId: z.string(),
  content: z.string(),
  title: z.string().nullish(),
  savedDocumentId: z.string().nullish(),
  pinnedThoughts: z.union([z.string(), z.array(z.string())]).nullish(),
  updatedAt: z.union([z.number(), z.string(), z.date()])
    .transform(v => (typeof v === 'number' ? v : new Date(v as string | Date).getTime()))
    .nullish(),
}).passthrough();

export type DraftDb = z.infer<typeof draftDbSchema>;
