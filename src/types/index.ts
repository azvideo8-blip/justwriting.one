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
  createdAt: Timestamp | Date | any;
}

export interface UserProfile {
  uid: string;
  email: string;
  nickname: string;
  role: string;
  isAnonymousDefault?: boolean;
  labels?: Label[];
}
