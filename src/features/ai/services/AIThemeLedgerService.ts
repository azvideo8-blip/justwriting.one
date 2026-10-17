import { getLocalDb, randomUUID, ThemeRecord, ThemeEvidence } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { cosineSimilarity } from '../utils/vectorSearch';
import { reportError } from '../../../shared/errors/reportError';
import { reportAIDegradation } from '../utils/aiDegradationReporter';
import { useActivityLogStore } from '../../../shared/activity/useActivityLogStore';
import { LocalStoreSyncService } from '../../../core/services/LocalStoreSyncService';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { localDayKey } from '../../../core/utils/dateUtils';
import { loadVisibleNoteKeys } from '../utils/retrieval/docSnapshot';


export const THEME_MATCH_THRESHOLD = 0.82;
export const MAX_EVIDENCE_COUNT = 3;

/**
 * R7F-020: очередь обязательных разборов тем. Записи — id документов, uid в
 * них нет, поэтому делить один ключ на два аккаунта нечем: он переехал на ключ
 * по аккаунту и попал в accountScopedLocalStorageKeys — выход одного человека
 * больше не сносит очередь другого, а своя уходит вместе с его данными.
 */
const PENDING_THEME_TOUCHES_KEY_PREFIX = 'jw_pending_theme_touches_';
/** Прежний общий ключ: разово переезжает в ключ текущего аккаунта. */
const LEGACY_PENDING_THEME_TOUCHES_KEY = 'jw_pending_theme_touches';

function pendingThemeTouchesKey(): string | null {
  const uid = getCurrentUser()?.uid;
  return uid ? `${PENDING_THEME_TOUCHES_KEY_PREFIX}${uid}` : null;
}

function migrateLegacyPendingTouches(key: string): string[] {
  const raw = localStorage.getItem(key);
  let list: string[] = [];
  try {
    list = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    list = [];
  }
  const legacyRaw = localStorage.getItem(LEGACY_PENDING_THEME_TOUCHES_KEY);
  if (legacyRaw === null) return list;
  let merged = list;
  try {
    const legacy = JSON.parse(legacyRaw) as string[];
    if (Array.isArray(legacy)) merged = [...new Set([...list, ...legacy])];
  } catch {
    /* намеренно: битый прежний список — это не данные, а мусор */
  }
  // Слитый список записывается ДО удаления прежнего ключа: иначе чтение без
  // последующей записи (или «уже в очереди») теряло прежние записи (ревью 0.10.0).
  localStorage.setItem(key, JSON.stringify(merged));
  localStorage.removeItem(LEGACY_PENDING_THEME_TOUCHES_KEY);
  return merged;
}

export function enqueuePendingThemeTouch(documentId: string): void {
  const key = pendingThemeTouchesKey();
  if (key === null) return;
  try {
    const list = migrateLegacyPendingTouches(key);
    if (list.includes(documentId)) return;
    list.push(documentId);
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {
    reportError(e, { action: 'AIThemeLedgerService/touchDocument' });
  }
}

export function getPendingThemeTouches(): string[] {
  const key = pendingThemeTouchesKey();
  if (key === null) return [];
  try {
    return migrateLegacyPendingTouches(key);
  } catch (e) {
    reportError(e, { action: 'AIThemeLedgerService/getPendingTouches' });
    return [];
  }
}

export function clearPendingThemeTouches(documentIds: string[]): void {
  const key = pendingThemeTouchesKey();
  if (key === null) return;
  try {
    const remaining = migrateLegacyPendingTouches(key).filter(id => !documentIds.includes(id));
    localStorage.setItem(key, JSON.stringify(remaining));
  } catch {
    /* намеренно: заметки просто пройдут разбор тем ещё раз */
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
 * Uses quotableSentence if provided and passes exact client substring check against noteContent.
 */
export function extractVerbatimSentence(
  noteContent: string,
  theme: string,
  quotableSentence?: string
): string {
  if (!noteContent || !noteContent.trim()) {
    return theme;
  }
  const cleanContent = noteContent.trim();

  // Client re-check (M2): use candidate quote only if it is an exact includes of noteContent
  if (quotableSentence && typeof quotableSentence === 'string') {
    const candidate = quotableSentence.trim();
    if (candidate && cleanContent.includes(candidate)) {
      return candidate;
    }
  }

  const sentences = cleanContent.match(/[^.!?;\n]+[.!?;\n]*/g)?.map(s => s.trim()).filter(Boolean) ?? [];

  if (sentences.length === 0) {
    return cleanContent.slice(0, 150);
  }

  const themeWords = theme.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let bestSentence = '';
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

  // No theme word occurred anywhere: return no quote rather than attributing an
  // unrelated opening sentence to this theme. The assembler skips empty evidence.
  return bestScore > 0 ? bestSentence : '';
}

export interface TouchThemesParams {
  documentId: string;
  themes: string[];
  eventDate: string; // YYYY-MM-DD
  valence?: number | undefined;
  arousal?: number | undefined;
  noteContent?: string | undefined;
  /**
   * The model-chosen verbatim quote from the summary (prompt v2). Used as the
   * theme's evidence sentence when it re-checks as an exact substring of the
   * note; otherwise the old word-overlap heuristic runs. Without this the
   * quote never leaves aiSummaries and the ledger keeps quoting by keyword
   * count — the heuristic step A exists to replace.
   */
  quotableSentence?: string | undefined;
}

export const AIThemeLedgerService = {
  /**
   * Touch themes write-path: reinforces existing active themes or creates new ones.
   * Atomic read-modify-write within an IndexedDB transaction + theme vector caching.
   */
  async touchThemes(params: TouchThemesParams): Promise<void> {
    const { documentId, themes, eventDate, valence, arousal, noteContent, quotableSentence } = params;
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
      const uid = getCurrentUser()?.uid;
      const canEmbed = uid ? hasIndexingConsent(uid) : false;
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
          } else if (canEmbed) {
            vec = null;
            try {
              const embRes = await AIService.embed({ content: cleanedTheme });
              if (embRes.ok && Array.isArray(embRes.vectors) && embRes.vectors.length > 0 && Array.isArray(embRes.vectors[0])) {
                vec = embRes.vectors[0];
              } else if (!embRes.ok) {
                reportAIDegradation({
                  feature: 'theme_ledger_embed',
                  cause: embRes.error,
                  action: 'Векторизация темы',
                  impact: 'Тема не векторизована',
                });
              }
            } catch (e) {
              reportError(e, { action: 'theme_ledger_embed_theme', theme: cleanedTheme }, 'warning');
              reportAIDegradation({
                feature: 'theme_ledger_embed',
                cause: e,
                action: 'Векторизация темы',
                impact: 'Тема не векторизована',
              });
            }
          }
          // Без согласия на поиск по смыслу тему не векторизуем — вектор пустой.
          vec ??= null;
          vectorByNorm.set(normalizedTheme, vec);
        }
        resolved.push({ cleanedTheme, themeVector: vec, sentence: extractVerbatimSentence(effectiveContent, cleanedTheme, quotableSentence) });
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
          // AG-MERGE-1: часы, а не день — иначе два устройства, подкрепившие
          // тему в один день, неразличимы для LWW-синхронизации.
          bestMatch.lastReinforcedAtMs = Date.now();
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
          LocalStoreSyncService.scheduleStoreSync('aiThemeLedger', bestMatch.id);
        } else {
          // --- CREATE BRANCH ---
          const newRecord: ThemeRecord = {
            id: randomUUID(),
            theme: cleanedTheme,
            themeVector: themeVector ?? [],
            firstSeenAt: eventDate,
            lastReinforcedAt: eventDate,
            lastReinforcedAtMs: Date.now(),
            count: 1,
            emotionalWeight,
            sensitivity: 'normal',
            tier: 'active',
            evidence: [{ noteId: documentId, eventDate, sentence }],
          };

          await store.put(newRecord);
          activeRecords.push(newRecord);
          LocalStoreSyncService.scheduleStoreSync('aiThemeLedger', newRecord.id);
        }

        // Reconcile branch stub (TODO Stage 3): cosine match != agreement; branch inactive in Stage 1.
      }

      await tx.done;
      
      if (resolved.length > 0) {
        useActivityLogStore.getState().addActivity(
          'activity_themes_touched',
          { action: 'touchThemes', documentId, themes: resolved.map(r => r.cleanedTheme).join(', ') },
          'info',
          'ai'
        );
      }
    } catch (e) {
      reportError(e, { action: 'ai_theme_ledger_touch', documentId });
      throw e;
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
            const eventDate = summary.eventDate ?? localDayKey(new Date(summary.processedAt));
            await this.touchThemes({
              documentId: docId,
              themes,
              eventDate,
              valence: summary.valence,
              arousal: summary.arousal,
              quotableSentence: summary.quotableSentence,
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
    const db = await getLocalDb();
    return await db.getAll('aiThemeLedger');
  },

  /**
   * R7Q-019: тема, у которой хоть одно доказательство лежит в скрытой, корзинной
   * или пропавшей заметке, не отдаётся вовсе — дословную фразу этой заметки из
   * summary хирургически не вырезать. Так же устроены грани профиля (W-3).
   */
  async getActive(): Promise<ThemeRecord[]> {
    const db = await getLocalDb();
    const rows = await db.getAllFromIndex('aiThemeLedger', 'by-tier', 'active');
    const visible = await loadVisibleNoteKeys();
    return rows.filter(t => t.evidence.every(e => visible.has(e.noteId)));
  },

  async get(id: string): Promise<ThemeRecord | undefined> {
    const db = await getLocalDb();
    return await db.get('aiThemeLedger', id);
  },
};
