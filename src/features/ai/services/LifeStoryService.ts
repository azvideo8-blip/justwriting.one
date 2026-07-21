import { getLocalDb, type LifeStoryEntry, type AITimelineEntry } from '../../../core/storage/localDb';

export const LifeStoryService = {
  async getAll(): Promise<LifeStoryEntry[]> {
    const db = await getLocalDb();
    const entries = await db.getAll('lifeStory');
    return entries.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  },

  async get(eventDate: string): Promise<LifeStoryEntry | undefined> {
    const db = await getLocalDb();
    return db.get('lifeStory', eventDate);
  },

  async save(entry: LifeStoryEntry): Promise<void> {
    const db = await getLocalDb();
    await db.put('lifeStory', entry);
  },

  async delete(eventDate: string): Promise<void> {
    const db = await getLocalDb();
    await db.delete('lifeStory', eventDate);
  },

  // Calculate default eventDate (writingDate - 1 day)
  getDefaultEventDate(writingDateStr: string): string {
    const d = new Date(writingDateStr);
    if (isNaN(d.getTime())) {
      const fallback = new Date();
      fallback.setDate(fallback.getDate() - 1);
      return fallback.toISOString().slice(0, 10);
    }
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  },

  // Automatically create/update a lifeStory entry from a timeline entry
  async autoPopulateFromTimeline(timelineEntry: AITimelineEntry): Promise<void> {
    const eventDate = this.getDefaultEventDate(timelineEntry.date);
    const existing = await this.get(eventDate);
    
    if (existing?.edited) {
      // Never overwrite user-edited entries
      return;
    }

    const text = timelineEntry.summary || 
      (timelineEntry.themes && timelineEntry.themes.length > 0 
        ? `Размышления на темы: ${timelineEntry.themes.join(', ')}.` 
        : 'Новая запись в дневнике.');

    const sourceDocumentIds = existing 
      ? Array.from(new Set([...existing.sourceDocumentIds, timelineEntry.documentId]))
      : [timelineEntry.documentId];

    await this.save({
      eventDate,
      text,
      sourceDocumentIds,
      generatedAt: Date.now()
    });
  },
};
