import { z } from 'zod';

export const firestoreTimestampSchema = z.union([
  z.object({ seconds: z.number(), nanoseconds: z.number() }),
  z.date(),
  z.number(),
  z.null(),
]).transform(v => v ?? null);

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
  createdAt: firestoreTimestampSchema,
  sessionStartTime: z.number().nullable().optional(),
  _encrypted: z.boolean().optional(),
  mood: z.string().optional(),
});

export const userProfileDbSchema = z.object({
  uid: z.string(),
  email: z.string().default(''),
  nickname: z.string().default('User'),
  role: z.enum(['admin', 'user']).optional(),
  encryptionSalt: z.string().optional(),
  encryptedDataKey: z.string().optional(),
  earnedAchievements: z.array(z.string()).default([]),
});

export const documentDbSchema = z.object({
  id: z.string(),
  userId: z.string().default(''),
  title: z.string().default(''),
  currentVersion: z.number().nonnegative().default(0),
  totalWords: z.number().nonnegative().default(0),
  totalDuration: z.number().nonnegative().default(0),
  sessionsCount: z.number().nonnegative().default(0),
  tags: z.array(z.string()).default([]),
  labelId: z.string().nullable().optional(),
  isPublic: z.boolean().optional(),
  firstSessionAt: firestoreTimestampSchema,
  lastSessionAt: firestoreTimestampSchema,
  mood: z.string().optional(),
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
  savedAt: firestoreTimestampSchema,
  sessionStartedAt: firestoreTimestampSchema,
  _encrypted: z.boolean().optional(),
  mood: z.string().optional(),
});
