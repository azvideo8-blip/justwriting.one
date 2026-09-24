import { Session } from '../../../shared/types/common';

export interface LifeLogVersion {
  wordsAdded: number;
  duration: number;
  savedAt: number;
}

export interface LifeLogDocument {
  localId?: string | undefined;
  cloudId?: string | undefined;
  title: string;
  totalWords: number;
  totalDuration: number;
  currentVersion: number;
  sessionsCount: number;
  firstSessionAt: number;
  lastSessionAt: number;
  tags: string[];
  labelId?: string | undefined;
  storage: { local: boolean; cloud: boolean };
  mood?: string | undefined;
  versions?: LifeLogVersion[] | undefined;
}

export interface DailySummary {
  totalWords: number;
  totalMinutes: number;
}

export interface SessionGroup {
  label: string;
  date: Date;
  sessions: Session[];
}
