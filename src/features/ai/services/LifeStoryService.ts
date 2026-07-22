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

  // Calculate default eventDate (writingDate as-is, fallback = current date)
  getDefaultEventDate(writingDateStr: string): string {
    const d = new Date(writingDateStr);
    if (isNaN(d.getTime())) {
      return new Date().toISOString().slice(0, 10);
    }
    return d.toISOString().slice(0, 10);
  },

  // Automatically create/update a lifeStory entry from a timeline entry
  async autoPopulateFromTimeline(timelineEntry: AITimelineEntry): Promise<void> {
    const eventDate = timelineEntry.eventDate ?? timelineEntry.date ?? this.getDefaultEventDate(timelineEntry.date);
    const existing = await this.get(eventDate);
    
    if (existing?.edited) {
      // Never overwrite user-edited entries
      return;
    }

    const db = await getLocalDb();
    const allTimeline = await db.getAll('aiTimeline');
    const sameDayEntries = allTimeline.filter(e => (e.eventDate ?? e.date) === eventDate);
    if (!sameDayEntries.some(e => e.documentId === timelineEntry.documentId)) {
      sameDayEntries.push(timelineEntry);
    }

    const distinctSummaries: string[] = [];
    for (const e of sameDayEntries) {
      const summaryText = e.summary || 
        (e.themes && e.themes.length > 0 
          ? `Размышления на темы: ${e.themes.join(', ')}.` 
          : '');
      if (summaryText && !distinctSummaries.includes(summaryText)) {
        distinctSummaries.push(summaryText);
      }
    }

    const text = distinctSummaries.length > 0 ? distinctSummaries.join(' • ') : 'Новая запись в дневнике.';

    const sourceDocumentIds = Array.from(new Set([
      ...(existing?.sourceDocumentIds ?? []),
      ...sameDayEntries.map(e => e.documentId),
    ])).filter(Boolean);

    await this.save({
      eventDate,
      text,
      sourceDocumentIds,
      generatedAt: Date.now()
    });
  },
};
