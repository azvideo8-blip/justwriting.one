import type { AIDocumentSummary, LocalDraft } from '../storage/localDb';
import type { UserProfile, Document } from '../../shared/types/common';

//
// Cloud Payloads
//

export type CloudSummaryPayload = AIDocumentSummary & { _encrypted?: boolean };

export type CloudDraftPayload = LocalDraft & { _encrypted?: boolean };

// `role` is deliberately excluded: firestore.rules reject it on create
// (!('role' in data)) and on update, because admin status is server-controlled.
// Listing it here would ask the rules to accept a client-written role.
export type CloudUserProfilePayload = Omit<UserProfile, 'role'> & { _encrypted?: boolean };

export interface CloudEmbeddingPayload {
  documentId: string;
  vectorsJson: string;
  vectorJson?: string;
  chunkTextsJson: string;
  model: string;
  dim: number;
  contentHash: string;
  processedAt: number;
  schemaV: number | null;
  _encrypted?: boolean;
}

// The `users/{uid}/documents/{id}` record only. Session/version fields
// (content, wordCount, duration, wpm, goals) belong to CloudVersionPayload and
// are rejected here by isValidDocumentUpdate's hasOnly. `id` is the document
// key, and `isPublic` is never written by DocumentService.
export type CloudDocumentPayload = Omit<Document, 'id' | 'isPublic'>;

// The record VersionService.addVersion actually writes — NOT VersionEncryptPayload,
// which is the encryption *input*: addVersion maps versionNumber -> version and
// derives wordsAdded/charsAdded, and previousContent is only used to compute
// them. Binding to the input shape asked the rules to allow fields nothing sends.
export interface CloudVersionPayload {
  documentId: string;
  userId: string;
  version: number;
  content: string;
  wordCount: number;
  wordsAdded: number;
  charsAdded: number;
  duration: number;
  wpm: number;
  goalWords: number | null;
  goalTime: number | null;
  goalReached: boolean;
  savedAt: unknown;
  sessionStartedAt: unknown;
  mood?: string;
  _encrypted?: boolean;
}

//
// Field Constants
//

export const SUMMARY_CLOUD_FIELDS = {
  documentId: true,
  summary: true,
  tone: true,
  frequentWords: true,
  authorPhrases: true,
  insights: true,
  quotableSentence: true,
  themes: true,
  extractedFacts: true,
  mentionedPeople: true,
  processedAt: true,
  commitments: true,
  valence: true,
  arousal: true,
  echo: true,
  contentHash: true,
  eventDate: true,
  promptVersion: true,
  _encrypted: true,
} satisfies Record<keyof CloudSummaryPayload, true>;

export const EMBEDDING_CLOUD_FIELDS = {
  documentId: true,
  vectorsJson: true,
  vectorJson: true,
  chunkTextsJson: true,
  model: true,
  dim: true,
  contentHash: true,
  processedAt: true,
  schemaV: true,
  _encrypted: true,
} satisfies Record<keyof CloudEmbeddingPayload, true>;

export const DRAFT_CLOUD_FIELDS = {
  userId: true,
  title: true,
  content: true,
  seconds: true,
  wpm: true,
  wordCount: true,
  initialWordCount: true,
  activeSessionId: true,
  pinnedThoughts: true,
  sessionStartTime: true,
  accumulatedDuration: true,
  totalPauseSeconds: true,
  savedDocumentId: true,
  tags: true,
  labelId: true,
  updatedAt: true,
  _encrypted: true,
} satisfies Record<keyof CloudDraftPayload, true>;

export const USER_PROFILE_CLOUD_FIELDS = {
  uid: true,
  email: true,
  nickname: true,
  labels: true,
  earnedAchievements: true,
  totalWordCount: true,
  sessionsCount: true,
  streakDays: true,
  totalDuration: true,
  avgWpm: true,
  avgSessionWords: true,
  encryptionSalt: true,
  encryptedDataKey: true,
  encryptionMeta: true,
  privacyAcceptedAt: true,
  privacyVersion: true,
  aiPortrait: true,
  _encrypted: true,
} satisfies Record<keyof CloudUserProfilePayload, true>;

export const DOCUMENT_CLOUD_FIELDS = {
  userId: true,
  uuid: true,
  title: true,
  tags: true,
  labelId: true,
  totalWords: true,
  totalDuration: true,
  currentVersion: true,
  mood: true,
  sessionsCount: true,
  firstSessionAt: true,
  lastSessionAt: true,
} satisfies Record<keyof CloudDocumentPayload, true>;

export const VERSION_CLOUD_FIELDS = {
  documentId: true,
  content: true,
  wordCount: true,
  userId: true,
  version: true,
  wordsAdded: true,
  charsAdded: true,
  duration: true,
  wpm: true,
  goalWords: true,
  goalTime: true,
  goalReached: true,
  savedAt: true,
  sessionStartedAt: true,
  _encrypted: true,
  mood: true,
} satisfies Record<keyof CloudVersionPayload, true>;
