import { getLocalDb, type AIMonthlyDigest } from '../../../core/storage/localDb';
import { AITimelineService } from './AITimelineService';
import { AIService } from './AIService';
import { AIBackgroundBudget } from './AIBackgroundBudget';

// ponytail: dedupe concurrent generation for the same month. save() fires this
// fire-and-forget on every summary; a bulk re-summarize (DiagnosticsPage) saves
// N notes before the first slow AI call writes the digest, so without this guard
// each save re-fires generateForMonth → N racing summarizeFacet calls for one month.
const inFlightMonths = new Set<string>();

export const AIMonthlyDigestService = {
  async generateForMonth(month: string): Promise<void> {
    if (inFlightMonths.has(month)) return;
    inFlightMonths.add(month);
    try {
      await generateForMonthInner(month);
    } finally {
      inFlightMonths.delete(month);
    }
  },

  async get(month: string): Promise<AIMonthlyDigest | undefined> {
    const db = await getLocalDb();
    return db.get('aiMonthlyDigest', month);
  },

  async getRecent(n = 3): Promise<AIMonthlyDigest[]> {
    const db = await getLocalDb();
    const all = await db.getAll('aiMonthlyDigest');
    // Sort by month desc and slice
    return all
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, n);
  },
};

async function generateForMonthInner(month: string): Promise<void> {
    const entries = await AITimelineService.getByMonth(month);
    if (entries.length < 2) return; // not enough data

    // Call summarizeFacet
    const notesInput = entries.map(e => ({
      title: e.date,
      excerpt: [e.summary ?? '', ...(e.facts ?? [])].filter(Boolean).join('. '),
    }));

    if (!AIBackgroundBudget.canSpend(1)) {
      console.warn(`[AIMonthlyDigestService] Skipping monthly digest for ${month}: background budget exhausted`);
      return;
    }

    const result = await AIService.summarizeFacet({
      notes: notesInput,
      focus: `${month} дневник`,
    });

    if (!result.ok) {
      console.warn(`[AIMonthlyDigestService] Failed to summarize facet for month ${month}:`, result.error);
      return;
    }

    AIBackgroundBudget.spend(1);

    // Compute dominant tone and tone/theme lists
    const toneCounts: Record<string, number> = {};
    const themeCounts: Record<string, number> = {};

    for (const entry of entries) {
      if (entry.tone) {
        const t = entry.tone.trim();
        toneCounts[t] = (toneCounts[t] ?? 0) + 1;
      }
      if (entry.themes) {
        for (const th of entry.themes) {
          const t = th.trim();
          themeCounts[t] = (themeCounts[t] ?? 0) + 1;
        }
      }
    }

    const tones = Object.entries(toneCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tone]) => tone);

    const themes = Object.entries(themeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([theme]) => theme);

    const dominantTone = tones[0] ?? '';
    let narrative = result.summary || '';

    // CTX-8: Append dominant tone to the narrative
    if (dominantTone) {
      narrative = `${narrative}\nПреобладающий тон месяца: ${dominantTone}.`;
    }

    const digest: AIMonthlyDigest = {
      month,
      narrative,
      tones,
      themes,
      noteCount: entries.length,
      generatedAt: Date.now(),
    };

    const db = await getLocalDb();
    await db.put('aiMonthlyDigest', digest);
}
