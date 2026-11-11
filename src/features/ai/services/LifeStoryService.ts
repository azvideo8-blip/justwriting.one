import { getLocalDb, type LifeStoryEntry } from '../../../core/storage/localDb';
import { localDayKey } from '../../../core/utils/dateUtils';

export const LifeStoryService = {
  async getAll(): Promise<LifeStoryEntry[]> {
    const db = await getLocalDb();
    const entries = await db.getAll('lifeStory');
    return entries.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  },

  // Calculate default eventDate (writingDate as-is, fallback = current date)
  getDefaultEventDate(writingDateStr: string): string {
    if (typeof writingDateStr !== 'string') return localDayKey();
    const trimmed = writingDateStr.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const d = new Date(year, month - 1, day);
      if (
        !isNaN(d.getTime()) &&
        d.getFullYear() === year &&
        d.getMonth() === month - 1 &&
        d.getDate() === day
      ) {
        return trimmed;
      }
      return localDayKey();
    }

    const d = new Date(trimmed);
    if (isNaN(d.getTime())) {
      return localDayKey();
    }
    return localDayKey(d);
  },
};
