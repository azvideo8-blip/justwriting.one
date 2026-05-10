import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, subDays } from 'date-fns';
import { Session } from '../../types';
import { toDate } from './dateUtils';

export const parseFirestoreDate = toDate;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getSessionDate(session: Session): Date | null {
  let date: Date | null;
  if (session.sessionStartTime) {
    date = new Date(session.sessionStartTime);
  } else {
    date = parseFirestoreDate(session.createdAt);
  }
  if (!date || isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function calculateStreak(sessions: Session[]) {
  if (sessions.length === 0) return 0;
  
  const dates = sessions
    .map(s => getSessionDate(s))
    .filter((d): d is Date => d !== null)
    .map(d => format(d, 'yyyy-MM-dd'));
  if (dates.length === 0) return 0;
  const uniqueDates = Array.from(new Set(dates)).sort((a, b) => b.localeCompare(a));
  
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  
  if (uniqueDates[0] !== today && uniqueDates[0] !== yesterday) {
    return 0;
  }
  
  let streak = 0;
  let checkDate = uniqueDates[0] === today ? new Date() : subDays(new Date(), 1);
  
  for (let i = 0; i < uniqueDates.length; i++) {
    if (uniqueDates[i] === format(checkDate, 'yyyy-MM-dd')) {
      streak++;
      checkDate = subDays(checkDate, 1);
    } else {
      break;
    }
  }
  
  return streak;
}

export function calculateBestStreak(sessions: Session[]): number {
  if (sessions.length === 0) return 0;
  const dates = new Set(
    sessions.map(s => getSessionDate(s))
      .filter((d): d is Date => d !== null)
      .map(d => format(d, 'yyyy-MM-dd'))
  );
  const sorted = [...dates]
    .map(d => new Date(d).getTime())
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  let max = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diffDays = Math.round((sorted[i] - sorted[i - 1]) / 86400000);
    if (diffDays === 1) { cur++; max = Math.max(max, cur); }
    else if (diffDays > 1) { cur = 1; }
  }
  return max;
}
