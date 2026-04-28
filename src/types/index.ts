import { Timestamp } from 'firebase/firestore';

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Session {
  id: string;
  userId: string;
  authorName: string;
  authorPhoto: string;
  nickname?: string;
  isAnonymous?: boolean;
  title?: string;
  content: string;
  duration: number;
  wordCount: number;
  charCount: number;
  wpm: number;
  isPublic: boolean;
  tags?: string[];
  labelId?: string;
  inkblots?: { id: string; index: number; color: string; timestamp: number }[];
  sessionStartTime?: number;
  createdAt: Timestamp | Date;
  _isLocal?: boolean;
}

export interface SessionPayload {
  [key: string]: unknown;
  userId: string;
  authorName: string;
  authorPhoto: string;
  nickname?: string;
  isAnonymous?: boolean;
  title?: string;
  content: string;
  pinnedThoughts?: string[];
  duration: number;
  wordCount: number;
  charCount: number;
  wpm: number;
  isPublic: boolean;
  tags?: string[];
  sessionType?: 'free' | 'stopwatch' | 'timer' | 'words' | 'finish-by';
  sessionStartTime?: number | null;
  goalReached?: boolean;
  updatedAt?: Timestamp;
  isEncrypted?: boolean;
  encryption?: { salt: string; iv: string };
}

export type AchievementTier = 'common' | 'rare' | 'legendary';

export interface Achievement {
  id: string;
  title: string;
  icon: string;
  threshold: number;
  tier: AchievementTier;
}

export interface UserProfile {
  uid: string;
  email: string;
  nickname: string;
  role?: string;
  isAnonymousDefault?: boolean;
  labels?: Label[];
  earnedAchievements?: string[];
  totalWordCount?: number;
  sessionsCount?: number;
  streakDays?: number;
  totalDuration?: number;
  avgWpm?: number;
  avgSessionWords?: number;
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
  isPublic: boolean;
  tags: string[];
  labelId?: string;
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
  goalWords?: number;
  goalTime?: number;
  goalReached?: boolean;
  savedAt: Timestamp;
  sessionStartedAt: Timestamp;
}
