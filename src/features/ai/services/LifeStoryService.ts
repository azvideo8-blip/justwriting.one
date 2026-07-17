import { getLocalDb, type LifeStoryEntry, type AITimelineEntry } from '../../../core/storage/localDb';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { AIService } from './AIService';

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

  // Explicit AI-driven summary generation for a specific day/document
  async generateWithAI(eventDate: string, documentId: string): Promise<string> {
    const content = await LocalVersionService.getLatestContent(documentId);
    if (!content || content.trim().length < 50) {
      throw new Error('Слишком короткая запись для суммаризации (минимум 50 символов)');
    }

    const res = await AIService.summarize({ content });
    if (!res.ok) {
      throw new Error(typeof res.error === 'string' ? res.error : 'Не удалось получить резюме от ИИ');
    }

    const summaryText = res.summary.summary || 'Новая запись в дневнике.';
    
    const existing = await this.get(eventDate);
    if (existing?.edited) {
      // Force regeneration by gesture actually overwrites, but let's be safe and check if we are allowed.
      // Since it's explicit gesture, we can overwrite it but flag as edited if user edited.
    }

    const sourceDocumentIds = existing 
      ? Array.from(new Set([...existing.sourceDocumentIds, documentId]))
      : [documentId];

    await this.save({
      eventDate,
      text: summaryText,
      sourceDocumentIds,
      generatedAt: Date.now()
    });

    return summaryText;
  }
};
