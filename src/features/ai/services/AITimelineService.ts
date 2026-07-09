import { getLocalDb, type AITimelineEntry } from '../../../core/storage/localDb';

export const AITimelineService = {
  async getByMonth(month: string): Promise<AITimelineEntry[]> {
    const db = await getLocalDb();
    return db.getAllFromIndex('aiTimeline', 'by-month', month);
  },

  async getByDateRange(from: string, to: string): Promise<AITimelineEntry[]> {
    const db = await getLocalDb();
    const range = IDBKeyRange.bound(from, to);
    return db.getAllFromIndex('aiTimeline', 'by-date', range);
  },

  async getMostRecent(n = 1): Promise<AITimelineEntry[]> {
    const db = await getLocalDb();
    const entries = await db.getAll('aiTimeline');
    return entries
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, n);
  },

  async rebuildFromSummaries(): Promise<number> {
    const db = await getLocalDb();
    const tx = db.transaction(['aiSummaries', 'documents', 'aiTimeline'], 'readwrite');
    const summariesStore = tx.objectStore('aiSummaries');
    const docsStore = tx.objectStore('documents');
    const timelineStore = tx.objectStore('aiTimeline');

    // Clear existing timeline entries first
    await timelineStore.clear();

    const summaries = await summariesStore.getAll();
    let count = 0;

    for (const summary of summaries) {
      const doc = await docsStore.get(summary.documentId);
      if (doc?.lastSessionAt) {
        const d = new Date(doc.lastSessionAt);
        if (isNaN(d.getTime())) continue;
        const date = d.toISOString().slice(0, 10);
        const month = d.toISOString().slice(0, 7);

        const timelineEntry: AITimelineEntry = {
          documentId: summary.documentId,
          date,
          month,
          facts: summary.extractedFacts ?? [],
          tone: summary.tone,
          themes: summary.themes ?? [],
        };
        if (summary.summary) {
          timelineEntry.summary = summary.summary;
        }
        await timelineStore.put(timelineEntry);
        count++;
      }
    }

    await tx.done;
    return count;
  },

  async getMoodByMonth(month: string): Promise<{ tone: string; count: number }[]> {
    const entries = await this.getByMonth(month);
    const counts: Record<string, number> = {};
    for (const e of entries) {
      if (e.tone) {
        counts[e.tone] = (counts[e.tone] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([tone, count]) => ({ tone, count }))
      .sort((a, b) => b.count - a.count);
  },

  async getMoodTrend(months = 3): Promise<{ month: string; dominantTone: string; toneDistribution: Record<string, number> }[]> {
    const db = await getLocalDb();
    const entries = await db.getAll('aiTimeline');

    // Group by month
    const monthlyGroups: Record<string, AITimelineEntry[]> = {};
    for (const e of entries) {
      let group = monthlyGroups[e.month];
      if (!group) {
        group = [];
        monthlyGroups[e.month] = group;
      }
      group.push(e);
    }

    // Process each month
    const trend = Object.entries(monthlyGroups).map(([month, monthEntries]) => {
      const toneDistribution: Record<string, number> = {};
      for (const e of monthEntries) {
        if (e.tone) {
          toneDistribution[e.tone] = (toneDistribution[e.tone] ?? 0) + 1;
        }
      }

      let dominantTone = '';
      let maxCount = -1;
      for (const [tone, count] of Object.entries(toneDistribution)) {
        if (count > maxCount) {
          maxCount = count;
          dominantTone = tone;
        }
      }

      return {
        month,
        dominantTone,
        toneDistribution,
      };
    });

    // Sort by month chronological ascending
    return trend
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-months);
  },
};
