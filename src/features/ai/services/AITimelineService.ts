import { carryCloudSyncFields, getLocalDb, type AITimelineEntry } from '../../../core/storage/localDb';
import { localDayKey, localMonthKey } from '../../../core/utils/dateUtils';
import { loadVisibleNoteKeys } from '../utils/retrieval/docSnapshot';

/** R7Q-019: запись хронологии принадлежит скрытой, корзинной или пропавшей заметке — читатель её не отдаёт. */
async function dropInvisible(entries: AITimelineEntry[]): Promise<AITimelineEntry[]> {
  const visible = await loadVisibleNoteKeys();
  return entries.filter(e => visible.has(e.documentId));
}

export const AITimelineService = {
  async getByMonth(month: string): Promise<AITimelineEntry[]> {
    const db = await getLocalDb();
    return dropInvisible(await db.getAllFromIndex('aiTimeline', 'by-month', month));
  },

  async getByDateRange(from: string, to: string): Promise<AITimelineEntry[]> {
    const db = await getLocalDb();
    const range = IDBKeyRange.bound(from, to);
    return dropInvisible(await db.getAllFromIndex('aiTimeline', 'by-date', range));
  },

  async getMostRecent(n = 1): Promise<AITimelineEntry[]> {
    const db = await getLocalDb();
    const entries = await dropInvisible(await db.getAll('aiTimeline'));
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

    // SF2-5: прежние строки снимаются ДО перезаписи — в них серверная отметка и
    // хэши принятой облачной версии; без них вся хронология после пересборки
    // становится «без базы», и выгрузка пертирает чужое (обёртка `db.put` этот
    // путь не видит: запись идёт внутри общей транзакции).
    const previousEntries = await timelineStore.getAll();
    const previousByDoc = new Map<string, Record<string, unknown>>(
      previousEntries.map(e => [e.documentId, e as unknown as Record<string, unknown>]),
    );

    // Clear existing timeline entries first
    await timelineStore.clear();

    const summaries = await summariesStore.getAll();
    let count = 0;

    for (const summary of summaries) {
      const doc = await docsStore.get(summary.documentId);
      if (doc?.lastSessionAt) {
        const d = new Date(doc.lastSessionAt);
        if (isNaN(d.getTime())) continue;
        const date = localDayKey(d);
        const month = localMonthKey(d);

        const timelineEntry: AITimelineEntry = {
          documentId: summary.documentId,
          date,
          month,
          facts: summary.extractedFacts ?? [],
          tone: summary.tone,
          themes: summary.themes ?? [],
          insights: summary.insights ?? [],
          eventDate: summary.eventDate ?? date,
        };
        if (summary.summary !== undefined) {
          timelineEntry.summary = summary.summary;
        }
        if (summary.valence !== undefined) {
          timelineEntry.valence = summary.valence;
        }
        if (summary.arousal !== undefined) {
          timelineEntry.arousal = summary.arousal;
        }
        await timelineStore.put(carryCloudSyncFields(
          timelineEntry as unknown as Record<string, unknown>,
          previousByDoc.get(summary.documentId),
        ) as never);
        count++;
      }
    }

    await tx.done;
    return count;
  },

  async getAffectTrend(nDays = 30): Promise<{ date: string; valence: number; arousal: number }[]> {
    const db = await getLocalDb();
    const entries = await dropInvisible(await db.getAll('aiTimeline'));
    return entries
      .filter(e => typeof e.valence === 'number' && typeof e.arousal === 'number')
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, nDays)
      .reverse() // chronological order
      .map(e => ({
        date: e.date,
        valence: e.valence!,
        arousal: e.arousal!,
      }));
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
    const entries = await dropInvisible(await db.getAll('aiTimeline'));

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
