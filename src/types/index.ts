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
}

export interface SessionPayload {
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

export interface UserProfile {
  uid: string;
  email: string;
  nickname: string;
  role?: string;
  isAnonymousDefault?: boolean;
  labels?: Label[];
  earnedAchievements?: string[];
}
