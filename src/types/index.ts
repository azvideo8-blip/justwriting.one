import { Timestamp } from 'firebase/firestore';

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
  createdAt: Timestamp | Date | any;
}

export interface UserProfile {
  nickname?: string;
  isAnonymousDefault?: boolean;
}
