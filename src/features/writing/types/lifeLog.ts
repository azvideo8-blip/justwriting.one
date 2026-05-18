import { Session } from '../../../shared/types/common';

export interface LifeLogDocument {
  localId?: string;
  cloudId?: string;
  title: string;
  totalWords: number;
  totalDuration: number;
  currentVersion: number;
  sessionsCount: number;
  firstSessionAt: number;
  lastSessionAt: number;
  tags: string[];
  labelId?: string;
  storage: { local: boolean; cloud: boolean };
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
