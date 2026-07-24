export interface EvaluatedCandidateRecord {
  id: string;
  category: 'safety' | 'attached_note' | 'persona' | 'portrait' | 'voice' | 'first_seen' | 'quote' | 'retrieval' | 'thread';
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

const MAX_JOURNAL_ENTRIES = 100;
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

    return fullEntry;
  },

  getEntries(limit = 20): JournalEntry[] {
    return journalBuffer.slice(0, limit);
  },

  clearJournal(): void {
    journalBuffer.length = 0;
  },

  getLatestEntry(): JournalEntry | null {
    return journalBuffer[0] ?? null;
  },
};
