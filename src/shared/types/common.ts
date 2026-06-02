import type { Timestamp } from 'firebase/firestore';

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface EncryptionMeta {
  salt: string;
  version: number;
  wrappedDataKey: string;
  verification: string;
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
  userId: string;
  title: string;
  currentVersion: number;
  totalWords: number;
  totalDuration: number;
  sessionsCount: number;
  firstSessionAt: Date | null;
  lastSessionAt: Date | null;
  isPublic?: boolean | undefined;
  tags: string[];
  labelId?: string | undefined;
  mood?: string | undefined;
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
}
