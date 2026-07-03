import { format } from 'date-fns';
import { STORAGE_KEYS } from '../../shared/constants/storageKeys';

export function getFrozenDates(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STREAK_FREEZES);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function saveFrozenDates(dates: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.STREAK_FREEZES, JSON.stringify([...dates]));
  } catch {
    // ignore
  }
}

export function clearFrozenDates(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.STREAK_FREEZES);
  } catch {
    // ignore
  }
}

export function wasFreezeUsedThisMonth(): boolean {
  const month = format(new Date(), 'yyyy-MM');
  for (const d of getFrozenDates()) {
    if (d.startsWith(month)) return true;
  }
  return false;
}
