import { getLocalDb } from '../../../core/storage/localDb';

export interface EvaluatedCandidateRecord {
  id: string;
  category: 'safety' | 'attached_note' | 'persona' | 'portrait' | 'voice' | 'first_seen' | 'quote' | 'retrieval' | 'thread' | 'turn1';
  band: 'mandatory' | 'competitive';
  textSnippet: string;
  charLength: number;
  salience?: number;
  similarity?: number;
  rawScore?: number;
  mmrScore?: number;
  selected: boolean;
  droppedReason?: 'budget_exceeded' | 'mmr_dedup' | 'low_score' | 'shadow_only';
}

export interface ShadowComparisonRecord {
  legacyResult: string | null;
  w2Result: string | null;
  overlapRatio: number;
  wouldHaveAdded: string[];
  wouldHaveDropped: string[];
}

export interface JournalEntry {
  id: string;
  timestamp: number;
  dialogueId?: string | null | undefined;
  candidates: EvaluatedCandidateRecord[];
  mandatoryInjected: string[];
  competitiveInjected: string[];
  shadowComparison?: ShadowComparisonRecord;
}

export interface JournalStats {
  totalTurns: number;
  /** null when no turn has produced a shadow comparison yet — "no data", NOT "perfect overlap". */
  medianOverlap: number | null;
  p90Overlap: number | null;
  mandatoryDropsCount: number;
  wouldHaveDroppedByCategory: Record<string, number>;
  p90BudgetUsage: number;
  maxBudget: number;
}

const MAX_JOURNAL_ENTRIES = 200;
const journalBuffer: JournalEntry[] = [];

/** Computes character/word overlap ratio between legacy and W2 strings in [0, 1]. */
export function calculateOverlapRatio(strA: string | null, strB: string | null): number {
  if (!strA && !strB) return 1.0;
  if (!strA || !strB) return 0.0;

  const wordsA = new Set(strA.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(strB.toLowerCase().split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1.0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0;

  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }

  const union = wordsA.size + wordsB.size - common;
  return union > 0 ? common / union : 0;
}

async function persistEntryToDb(entry: JournalEntry): Promise<void> {
  try {
    const db = await getLocalDb();
    await db.put('aiInjectionJournal', entry as unknown as Record<string, unknown>);

    // Ring-buffer eviction: check total count
    const all = await db.getAllFromIndex('aiInjectionJournal', 'by-timestamp');
    if (all.length > MAX_JOURNAL_ENTRIES) {
      const toDeleteCount = all.length - MAX_JOURNAL_ENTRIES;
      const oldestToDelete = all.slice(0, toDeleteCount);
      const tx = db.transaction('aiInjectionJournal', 'readwrite');
      for (const item of oldestToDelete) {
        if (item.id) {
          void tx.store.delete(item.id as string);
        }
      }
      await tx.done;
    }
  } catch {
    /* Non-blocking write fallback */
  }
}

export const InjectionJournal = {
  logEntry(entry: Omit<JournalEntry, 'id' | 'timestamp'>): JournalEntry {
    const fullEntry: JournalEntry = {
      ...entry,
      id: `jnl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };

    journalBuffer.unshift(fullEntry);
    if (journalBuffer.length > MAX_JOURNAL_ENTRIES) {
      journalBuffer.pop();
    }

    // Non-blocking IDB write
    void persistEntryToDb(fullEntry);

    return fullEntry;
  },

  async loadEntriesFromDb(): Promise<JournalEntry[]> {
    try {
      const db = await getLocalDb();
      const records = await db.getAllFromIndex('aiInjectionJournal', 'by-timestamp');
      const sorted = (records as unknown as JournalEntry[]).sort((a, b) => b.timestamp - a.timestamp);
      
      journalBuffer.length = 0;
      journalBuffer.push(...sorted.slice(0, MAX_JOURNAL_ENTRIES));
      return [...journalBuffer];
    } catch {
      return [...journalBuffer];
    }
  },

  getEntries(limit = 20): JournalEntry[] {
    return journalBuffer.slice(0, limit);
  },

  clearJournal(): void {
    journalBuffer.length = 0;
    void (async () => {
      try {
        const db = await getLocalDb();
        await db.clear('aiInjectionJournal');
      } catch {
        /* ignore */
      }
    })();
  },

  getLatestEntry(): JournalEntry | null {
    return journalBuffer[0] ?? null;
  },

  getStats(maxBudget = 6_000): JournalStats {
    const entries = [...journalBuffer];
    if (entries.length === 0) {
      return {
        totalTurns: 0,
        medianOverlap: null,
        p90Overlap: null,
        mandatoryDropsCount: 0,
        wouldHaveDroppedByCategory: {},
        p90BudgetUsage: 0,
        maxBudget,
      };
    }

    const overlaps: number[] = [];
    const budgetUsages: number[] = [];
    let mandatoryDropsCount = 0;
    const wouldHaveDroppedByCategory: Record<string, number> = {};

    for (const entry of entries) {
      if (entry.shadowComparison) {
        overlaps.push(entry.shadowComparison.overlapRatio);
      }

      const mandatoryChars = entry.mandatoryInjected.reduce((acc, s) => acc + s.length, 0);
      const competitiveChars = entry.competitiveInjected.reduce((acc, s) => acc + s.length, 0);
      budgetUsages.push(mandatoryChars + competitiveChars);

      for (const cand of entry.candidates) {
        if (!cand.selected) {
          if (cand.band === 'mandatory') {
            mandatoryDropsCount++;
          }
          wouldHaveDroppedByCategory[cand.category] = (wouldHaveDroppedByCategory[cand.category] || 0) + 1;
        }
      }
    }

    overlaps.sort((a, b) => a - b);
    budgetUsages.sort((a, b) => a - b);

    // Index each percentile against ITS OWN array. `overlaps` only grows on turns
    // that produced a shadow comparison, while `budgetUsages` grows on every turn,
    // so a shared index read budget usage from too low a position and understated
    // p90 — one of the four go/no-go criteria.
    const medianOverlap = overlaps[Math.floor(overlaps.length * 0.5)] ?? null;
    const p90Overlap = overlaps[Math.floor(overlaps.length * 0.9)] ?? null;
    const p90BudgetUsage = budgetUsages[Math.floor(budgetUsages.length * 0.9)] ?? 0;

    return {
      totalTurns: entries.length,
      medianOverlap,
      p90Overlap,
      mandatoryDropsCount,
      wouldHaveDroppedByCategory,
      p90BudgetUsage,
      maxBudget,
    };
  },
};
