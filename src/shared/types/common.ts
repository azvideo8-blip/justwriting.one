import type { Timestamp } from 'firebase/firestore';

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  nickname: string;
  role?: string;
  labels?: Label[];
  earnedAchievements?: string[];
  totalWordCount?: number;
  sessionsCount?: number;
  streakDays?: number;
  totalDuration?: number;
  avgWpm?: number;
  avgSessionWords?: number;
  encryptionSalt?: string;
  encryptedDataKey?: string;
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
  authorName?: string;
  authorPhoto?: string;
  nickname?: string;
  title?: string;
  content: string;
  duration: number;
  wordCount: number;
  charCount: number;
  wpm: number;
  isPublic?: boolean;
  tags?: string[];
  mood?: string;
}

export interface Session extends SessionCore {
  id: string;
  labelId?: string;
  sessionStartTime?: number | null;
  createdAt: Timestamp | Date | number;
  _isLocal?: boolean;
  _isLegacy?: boolean;
  _hasCloudCopy?: boolean;
  _aiProcessed?: boolean;
  _aiAction?: string;
  _aiProcessedAt?: any;
  _aiResultText?: string;
}

export interface SessionPayload extends SessionCore {
  pinnedThoughts?: string[];
  sessionType?: 'free' | 'stopwatch' | 'timer' | 'words' | 'finish-by';
  sessionStartTime?: number | null;
  goalReached?: boolean;
  updatedAt?: Timestamp | Date | number;
}

export interface Document {
  id: string;
  userId: string;
  title: string;
  currentVersion: number;
  totalWords: number;
  totalDuration: number;
  sessionsCount: number;
  firstSessionAt: Timestamp;
  lastSessionAt: Timestamp;
  isPublic?: boolean;
  tags: string[];
  labelId?: string;
  mood?: string;
}

export interface Version {
  [key: string]: unknown;
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
  goalWords?: number;
  goalTime?: number;
  goalReached?: boolean;
  savedAt: Timestamp;
  sessionStartedAt: Timestamp;
}
