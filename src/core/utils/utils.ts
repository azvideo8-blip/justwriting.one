import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { format, subDays } from 'date-fns';
import { Session } from '../../types';
import { toDate } from './dateUtils';
import { getFrozenDates, saveFrozenDates } from './streakFreeze';

export const parseFirestoreDate = toDate;

// Register the design-system's custom font-size utilities (defined in index.css)
// so tailwind-merge treats them as font sizes (e.g. a bespoke `text-label` must
// override a primitive's default `text-sm`). Mirrors shared/utils/cn.ts.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "label-sm"] }],
    },
  },
});

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
  const today = format(new Date(), 'yyyy-MM-dd');
  const uniqueDates = Array.from(new Set(dates))
    .filter(d => d <= today)
    .sort((a, b) => b.localeCompare(a));
  
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  
  if (uniqueDates[0] !== today && uniqueDates[0] !== yesterday) {
    return 0;
  }
  
  const frozenDates = getFrozenDates();
  const frozenMonths = new Set<string>();
  for (const d of frozenDates) frozenMonths.add(d.substring(0, 7));
  let freezesChanged = false;
  
  let streak = 0;
  let checkDate = uniqueDates[0] === today ? new Date() : subDays(new Date(), 1);
  
  let i = 0;
  while (i < uniqueDates.length) {
    if (uniqueDates[i] === format(checkDate, 'yyyy-MM-dd')) {
      streak++;
      checkDate = subDays(checkDate, 1);
      i++;
    } else {
      const nextExpected = format(subDays(checkDate, 1), 'yyyy-MM-dd');
      if (uniqueDates[i] === nextExpected) {
        const missedDay = format(checkDate, 'yyyy-MM-dd');
        const missedMonth = missedDay.substring(0, 7);
        const alreadyFrozen = frozenDates.has(missedDay);
        if (alreadyFrozen || !frozenMonths.has(missedMonth)) {
          if (!alreadyFrozen) {
            frozenDates.add(missedDay);
            frozenMonths.add(missedMonth);
            freezesChanged = true;
          }
          streak++;
          checkDate = subDays(checkDate, 1);
          continue;
        }
      }
      break;
    }
  }
  
  if (freezesChanged) saveFrozenDates(frozenDates);
  
  return streak;
}

export function calculateBestStreak(sessions: Session[]): number {
  if (sessions.length === 0) return 0;
  const today = format(new Date(), 'yyyy-MM-dd');
  const dates = new Set(
    sessions.map(s => getSessionDate(s))
      .filter((d): d is Date => d !== null)
      .map(d => format(d, 'yyyy-MM-dd'))
      .filter(d => d <= today)
  );
  const sorted = [...dates]
    .map(d => {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y!, m! - 1, day!).getTime();
    })
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  
  const frozenDates = getFrozenDates();
  const frozenMonths = new Set<string>();
  for (const d of frozenDates) frozenMonths.add(d.substring(0, 7));
  let freezesChanged = false;
  
  let max = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diffDays = Math.round((sorted[i]! - sorted[i - 1]!) / 86400000);
    if (diffDays === 1) { cur++; max = Math.max(max, cur); }
    else if (diffDays === 2) {
      const prevDate = new Date(sorted[i - 1]!);
      prevDate.setDate(prevDate.getDate() + 1);
      const missedDay = format(prevDate, 'yyyy-MM-dd');
      const missedMonth = missedDay.substring(0, 7);
      const alreadyFrozen = frozenDates.has(missedDay);
      if (alreadyFrozen || !frozenMonths.has(missedMonth)) {
        if (!alreadyFrozen) {
          frozenDates.add(missedDay);
          frozenMonths.add(missedMonth);
          freezesChanged = true;
        }
        cur += 2;
        max = Math.max(max, cur);
      } else {
        cur = 1;
      }
    }
    else if (diffDays > 2) { cur = 1; }
  }
  if (freezesChanged) saveFrozenDates(frozenDates);
  return max;
}
