import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, subDays } from 'date-fns';
import { Session } from '../../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseFirestoreDate(date: unknown): Date {
  if (!date) return new Date();
  if (date instanceof Date) return date;
  if (typeof date === 'object' && date !== null) {
    const d = date as { toDate?: () => Date; seconds?: number };
    if (typeof d.toDate === 'function') return d.toDate();
    if (typeof d.seconds === 'number') return new Date(d.seconds * 1000);
  }
  return new Date(date as string | number);
}

export function calculateStreak(sessions: Session[]) {
  if (sessions.length === 0) return 0;
  
  const dates = sessions.map(s => {
    const date = parseFirestoreDate(s.createdAt);
    return format(date, 'yyyy-MM-dd');
  });
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
