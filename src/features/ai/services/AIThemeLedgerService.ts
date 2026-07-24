import { getLocalDb, randomUUID, ThemeRecord, ThemeEvidence } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { cosineSimilarity } from '../utils/vectorSearch';
import { reportError } from '../../../shared/errors/reportError';

export const THEME_MATCH_THRESHOLD = 0.82;
export const MAX_EVIDENCE_COUNT = 3;

const PENDING_THEME_TOUCHES_KEY = 'jw_pending_theme_touches';

export function enqueuePendingThemeTouch(documentId: string): void {
  try {
    const raw = localStorage.getItem(PENDING_THEME_TOUCHES_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(documentId)) {
      list.push(documentId);
      localStorage.setItem(PENDING_THEME_TOUCHES_KEY, JSON.stringify(list));
    }
  } catch {
    /* ignore storage failure */
  }
}

export function getPendingThemeTouches(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_THEME_TOUCHES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function clearPendingThemeTouches(documentIds: string[]): void {
  try {
    const remaining = getPendingThemeTouches().filter(id => !documentIds.includes(id));
    localStorage.setItem(PENDING_THEME_TOUCHES_KEY, JSON.stringify(remaining));
  } catch {
    /* ignore storage failure */
  }
}

/**
 * Calculates emotional weight clamped to [0, 1] as max(|valence|, arousal).
 */
export function calculateEmotionalWeight(valence?: number, arousal?: number): number {
  const v = Math.abs(valence ?? 0);
  const a = Math.abs(arousal ?? 0);
  const maxVal = Math.max(v, a);
  return Math.min(1, Math.max(0, maxVal));
}

/**
 * Extracts a verbatim sentence from note text matching the theme, or falls back to excerpt.
 */
export function extractVerbatimSentence(noteContent: string, theme: string): string {
  if (!noteContent || !noteContent.trim()) {
    return theme;
  }
  const cleanContent = noteContent.trim();
  const sentences = cleanContent.match(/[^.!?;\n]+[.!?;\n]*/g)?.map(s => s.trim()).filter(Boolean) ?? [];

  if (sentences.length === 0) {
    return cleanContent.slice(0, 150);
  }

  const themeWords = theme.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let bestSentence: string = sentences[0] ?? cleanContent.slice(0, 150);
  let bestScore = 0;

  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase();
    let score = 0;
    for (const word of themeWords) {
      if (lowerSentence.includes(word)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }

  return bestSentence;
}

export interface TouchThemesParams {
  documentId: string;
  themes: string[];
  eventDate: string; // YYYY-MM-DD
  valence?: number | undefined;
  arousal?: number | undefined;
  noteContent?: string | undefined;
}

export const AIThemeLedgerService = {
  /**
   * Touch themes write-path: reinforces existing active themes or creates new ones.
   * Atomic read-modify-write within an IndexedDB transaction + theme vector caching.
   */
  async touchThemes(params: TouchThemesParams): Promise<void> {
    const { documentId, themes, eventDate, valence, arousal, noteContent } = params;
    if (themes.length === 0) return;

    try {
      const db = await getLocalDb();

      // Fetch note content if not directly provided
      let effectiveContent = noteContent ?? '';
      if (effectiveContent === '') {
        try {
          const versions = await db.getAllFromIndex('versions', 'by-document', documentId);
          if (versions.length > 0) {
            const sorted = versions.sort((a, b) => b.version - a.version);
            effectiveContent = sorted[0]?.content ?? '';
          }
        } catch {
          /* fallback to empty */
        }
      }

      const emotionalWeight = calculateEmotionalWeight(valence, arousal);

      // Pass 1 (OUTSIDE any IDB transaction): resolve a vector for each theme.
      // embed() is a network call — awaiting it inside a readwrite transaction
      // lets the transaction auto-close, so the later put() throws
      // TransactionInactiveError in real browsers (fake-indexeddb masks this).
      // Cache by normalized string: repeated/known themes cost 0 embed calls.
      const existingForCache = await db.getAll('aiThemeLedger');
      const vectorByNorm = new Map<string, number[] | null>();
      const resolved: { cleanedTheme: string; themeVector: number[] | null; sentence: string }[] = [];
      for (const rawTheme of themes) {
        const cleanedTheme = rawTheme.trim();
        if (cleanedTheme === '') continue;
        const normalizedTheme = cleanedTheme.toLowerCase();
        let vec = vectorByNorm.get(normalizedTheme);
        if (vec === undefined) {
          const cached = existingForCache.find(
            r => r.tier === 'active' && r.theme.toLowerCase().trim() === normalizedTheme && r.themeVector.length > 0,
          );
          if (cached !== undefined) {
            vec = cached.themeVector;
          } else {
            vec = null;
            try {
              const embRes = await AIService.embed({ content: cleanedTheme });
              if (embRes.ok && Array.isArray(embRes.vectors) && embRes.vectors.length > 0 && Array.isArray(embRes.vectors[0])) {
                vec = embRes.vectors[0];
              }
            } catch (e) {
              reportError(e, { action: 'theme_ledger_embed_theme', theme: cleanedTheme }, 'warning');
            }
          }
          vectorByNorm.set(normalizedTheme, vec);
        }
        resolved.push({ cleanedTheme, themeVector: vec, sentence: extractVerbatimSentence(effectiveContent, cleanedTheme) });
      }

      // Pass 2 (IDB transaction ONLY — no non-IDB awaits inside): atomic RMW.
      const tx = db.transaction('aiThemeLedger', 'readwrite');
      const store = tx.objectStore('aiThemeLedger');
      const allRecords = await store.getAll();
      const activeRecords = allRecords.filter(r => r.tier === 'active');

      for (const { cleanedTheme, themeVector, sentence } of resolved) {
        let bestMatch: ThemeRecord | null = null;
        let bestSimilarity = -1;

        if (themeVector !== null) {
          for (const record of activeRecords) {
            if (record.themeVector.length > 0) {
              const sim = cosineSimilarity(themeVector, record.themeVector);
              if (sim >= THEME_MATCH_THRESHOLD && sim > bestSimilarity) {
                bestSimilarity = sim;
                bestMatch = record;
              }
            }
          }
        }

        if (bestMatch !== null) {
          // --- REINFORCE BRANCH ---
          bestMatch.count += 1;

          if (eventDate > bestMatch.lastReinforcedAt) {
            bestMatch.lastReinforcedAt = eventDate;
          }
          if (eventDate < bestMatch.firstSeenAt) {
            bestMatch.firstSeenAt = eventDate;
          }

          bestMatch.emotionalWeight = Math.max(bestMatch.emotionalWeight, emotionalWeight);

          // Update evidence list (cap ~3 items: keep earliest, newest, and top salience)
          const existingEvIdx = bestMatch.evidence.findIndex(e => e.noteId === documentId);
          if (existingEvIdx >= 0) {
            bestMatch.evidence[existingEvIdx] = { noteId: documentId, eventDate, sentence };
          } else {
            const newEv: ThemeEvidence = { noteId: documentId, eventDate, sentence };
            const updatedEv = [...bestMatch.evidence, newEv];
            updatedEv.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
            if (updatedEv.length > MAX_EVIDENCE_COUNT) {
              const first = updatedEv[0]!;
              const last = updatedEv[updatedEv.length - 1]!;
              const middleCandidates = updatedEv.slice(1, updatedEv.length - 1);
              // Top-1 by salience (longest sentence match)
              middleCandidates.sort((a, b) => b.sentence.length - a.sentence.length);
              const topSalience = middleCandidates[0]!;
              bestMatch.evidence = [first, topSalience, last];
            } else {
              bestMatch.evidence = updatedEv;
            }
          }

          await store.put(bestMatch);
        } else {
          // --- CREATE BRANCH ---
          const newRecord: ThemeRecord = {
            id: randomUUID(),
            theme: cleanedTheme,
            themeVector: themeVector ?? [],
            firstSeenAt: eventDate,
            lastReinforcedAt: eventDate,
            count: 1,
            emotionalWeight,
            sensitivity: 'normal',
            tier: 'active',
            evidence: [{ noteId: documentId, eventDate, sentence }],
          };

          await store.put(newRecord);
          activeRecords.push(newRecord);
        }

        // Reconcile branch stub (TODO Stage 3): cosine match != agreement; branch inactive in Stage 1.
      }

      await tx.done;
    } catch (e) {
      reportError(e, { action: 'ai_theme_ledger_touch', documentId });
    }
  },

  /**
   * Process all pending theme touches in background.
   */
  async processPendingThemeTouches(): Promise<void> {
    const pending = getPendingThemeTouches();
    if (pending.length === 0) return;

    try {
      const db = await getLocalDb();
      const processed: string[] = [];

      for (const docId of pending) {
        try {
          const summary = await db.get('aiSummaries', docId);
          if (summary && (summary.themes?.length ?? 0) > 0) {
            const themes = summary.themes;
            const eventDate = summary.eventDate ?? new Date(summary.processedAt).toISOString().slice(0, 10);
            await this.touchThemes({
              documentId: docId,
              themes,
              eventDate,
              valence: summary.valence,
              arousal: summary.arousal,
            });
          }
          processed.push(docId);
        } catch (e) {

          reportError(e, { action: 'processPendingThemeTouches', docId });
        }
      }

      if (processed.length > 0) {
        clearPendingThemeTouches(processed);
      }
    } catch (e) {
      reportError(e, { action: 'processPendingThemeTouches_batch' });
    }
  },

  async getAll(): Promise<ThemeRecord[]> {
    try {
      const db = await getLocalDb();
      return await db.getAll('aiThemeLedger');
    } catch (e) {
      reportError(e, { action: 'ai_theme_ledger_get_all' });
      return [];
    }
  },

  async getActive(): Promise<ThemeRecord[]> {
    try {
      const db = await getLocalDb();
      return await db.getAllFromIndex('aiThemeLedger', 'by-tier', 'active');
    } catch (e) {
      reportError(e, { action: 'ai_theme_ledger_get_active' });
      return [];
    }
  },

  async get(id: string): Promise<ThemeRecord | undefined> {
    try {
      const db = await getLocalDb();
      return await db.get('aiThemeLedger', id);
    } catch (e) {
      reportError(e, { action: 'ai_theme_ledger_get', id });
      return undefined;
    }
  },
};
