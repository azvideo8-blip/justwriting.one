import { useRef, useEffect, useCallback } from 'react';
import { findStaleDocuments, indexDocument, findStaleSummaries, sha256Hex } from '../utils/embeddingIndexer';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import { AITaxonomyService } from '../services/AITaxonomyService';
import { AIFacetJudgeService } from '../services/AIFacetJudgeService';
import { rebuildWordCloud } from '../../archive/hooks/useArchiveWordCloud';
import { reportError } from '../../../shared/errors/reportError';
import { AIBackgroundBudget } from '../services/AIBackgroundBudget';
import { AISummaryService } from '../services/AISummaryService';
import { AIService } from '../services/AIService';
import { getLocalDb, type AIDocumentSummary } from '../../../core/storage/localDb';

const BATCH_SIZE = 3;
const DEBOUNCE_MS = 30_000;
const RESUMMARIZE_DEBOUNCE_MS = 60_000;
const BACKOFF_MS: Record<string, number> = {
  DAILY_LIMIT: 300_000,
  RATE_LIMIT: 60_000,
};
const IDLE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 120_000;

const DAILY_LIMIT = 20;
const INDEXER_STORAGE_KEY = 'embed_indexer_daily_usage';

function getIndexerDailyUsage(): { date: string; count: number } {
  try {
    const raw = localStorage.getItem(INDEXER_STORAGE_KEY);
    if (!raw) return { date: new Date().toISOString().slice(0, 10), count: 0 };
    const parsed = JSON.parse(raw);
    if (parsed.date !== new Date().toISOString().slice(0, 10)) {
      return { date: new Date().toISOString().slice(0, 10), count: 0 };
    }
    return parsed;
  } catch {
    return { date: new Date().toISOString().slice(0, 10), count: 0 };
  }
}

function incrementIndexerDailyUsage(): void {
  const usage = getIndexerDailyUsage();
  try {
    localStorage.setItem(INDEXER_STORAGE_KEY, JSON.stringify({ date: usage.date, count: usage.count + 1 }));
  } catch {
    // localStorage unavailable — usage tracking is best-effort, fail open
  }
}

export function useEmbeddingIndexer(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffUntilRef = useRef<number>(0);
  const runningRef = useRef(false);
  const resummarizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyCountRef = useRef(0);
  const wordCloudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleWordCloudRebuild = useCallback(() => {
    if (wordCloudTimerRef.current) clearTimeout(wordCloudTimerRef.current);
    wordCloudTimerRef.current = setTimeout(() => {
      void rebuildWordCloud().catch(e => reportError(e, { action: '[useEmbeddingIndexer] word cloud rebuild failed' }));
    }, 8_000);
  }, []);

  const scheduleResummarize = useCallback(() => {
    dirtyCountRef.current += 1;
    if (resummarizeTimerRef.current) clearTimeout(resummarizeTimerRef.current);
    resummarizeTimerRef.current = setTimeout(() => {
      void AIProfileFacetService.resummarizeDirty().then(r => {
        console.warn(`[useEmbeddingIndexer] resummarized ${r.count} dirty facets`);
        dirtyCountRef.current = 0;
        // Fill in any pending LLM summaries from a recent build.
        void AIProfileFacetService.summarizePending().then(sp => {
          if (sp.done > 0) console.warn(`[useEmbeddingIndexer] summarized ${sp.done} pending facets`);
        }).catch(e => reportError(e, { action: '[useEmbeddingIndexer] summarizePending failed' }));
        if (r.count > 0) {
          // Judge the (re)written summaries and auto-correct confabulations
          // BEFORE regenerating the portrait, so the portrait reads corrected
          // facets. Best-effort: portrait regen runs regardless.
          void AIFacetJudgeService.review()
            .then(j => { if (j.corrected > 0) console.warn(`[useEmbeddingIndexer] judge corrected ${j.corrected}/${j.judged} facets`); })
            .catch(e => reportError(e, { action: '[useEmbeddingIndexer] facet judge failed' }))
            .finally(() => {
              void import('../services/AIProfileService').then(({ AIProfileService }) => {
                void AIProfileService.generate()
                  .then(() => console.warn('[useEmbeddingIndexer] auto-regenerated portrait successfully'))
                  .catch(e => reportError(e, { action: '[useEmbeddingIndexer] auto portrait generation failed' }));
              });
            });
        }
      }).catch(e => {
        reportError(e, { action: '[useEmbeddingIndexer] resummarize failed' });
      });
    }, RESUMMARIZE_DEBOUNCE_MS);
  }, []);

  const runBatch = useCallback(async () => {
    if (runningRef.current) return;
    if (localStorage.getItem('auto_summarize_enabled') === 'false') return;
    const now = Date.now();
    if (now < backoffUntilRef.current) return;

    runningRef.current = true;
    try {
      const usage = getIndexerDailyUsage();
      if (usage.count < DAILY_LIMIT) {
        const staleIds = await findStaleDocuments();
        const remaining = DAILY_LIMIT - usage.count;
        const batch = staleIds.slice(0, Math.min(BATCH_SIZE, remaining));

        for (const docId of batch) {
          const result = await indexDocument(docId);
          if (result === 'daily') {
            backoffUntilRef.current = Date.now() + BACKOFF_MS['DAILY_LIMIT']!;
            break;
          }
          if (result === 'rate') {
            backoffUntilRef.current = Date.now() + BACKOFF_MS['RATE_LIMIT']!;
            break;
          }
          if (result === 'ok') {
            incrementIndexerDailyUsage();
            void AIProfileFacetService.incrementalUpdate(docId).then(() => {
              scheduleResummarize();
            }).catch(e =>
              reportError(e, { action: '[useEmbeddingIndexer] incremental facet update failed' }),
            );
            scheduleWordCloudRebuild();
          }
        }
      }

      // Summarization step
      if (localStorage.getItem('auto_summarize_enabled') !== 'false') {
        const staleSumIds = await findStaleSummaries();
        if (staleSumIds.length > 0) {
          const db = await getLocalDb();
          const limit = BATCH_SIZE;
          let count = 0;
          for (const docId of staleSumIds) {
            if (count >= limit) break;
            if (!AIBackgroundBudget.canSpend(1)) break;

            const doc = await db.get('documents', docId);
            if (!doc) continue;

            const versions = await db.getAllFromIndex('versions', 'by-document', docId);
            if (versions.length === 0) continue;
            versions.sort((a, b) => b.version - a.version);
            const content = versions[0]?.content ?? '';
            if (content.length < 50) continue;

            // Build recentContext
            const summaries = await db.getAll('aiSummaries');
            summaries.sort((a, b) => b.processedAt - a.processedAt);
            const recentContext = summaries.slice(0, 3).map(s => s.summary || s.tone).filter(Boolean).join('\n');

            const res = await AIService.summarize({
              content: content.slice(0, 50_000),
              mood: doc.mood,
              recentContext
            });

            if (res.ok) {
              const hash = await sha256Hex(content);
              const s: AIDocumentSummary = {
                documentId: docId,
                tone: res.summary.tone,
                frequentWords: res.summary.frequentWords,
                insights: res.summary.insights,
                themes: res.summary.themes,
                extractedFacts: res.summary.extractedFacts,
                processedAt: Date.now(),
                contentHash: hash,
              };
              if (res.summary.summary !== undefined) s.summary = res.summary.summary;
              if (res.summary.mentionedPeople !== undefined) s.mentionedPeople = res.summary.mentionedPeople;
              if (res.summary.commitments !== undefined) s.commitments = res.summary.commitments;
              if (res.summary.valence !== undefined) s.valence = res.summary.valence;
              if (res.summary.arousal !== undefined) s.arousal = res.summary.arousal;
              if (res.summary.echo !== undefined) s.echo = res.summary.echo;
              await AISummaryService.save(s);

              AIBackgroundBudget.spend(1);
              count++;
              // Gentle spacing between real summarize calls
              await new Promise(r => setTimeout(r, 150));
            } else {
              if (res.error === 'DAILY_LIMIT') {
                backoffUntilRef.current = Date.now() + BACKOFF_MS['DAILY_LIMIT']!;
                break;
              }
              if (res.error === 'RATE_LIMIT') {
                backoffUntilRef.current = Date.now() + BACKOFF_MS['RATE_LIMIT']!;
                break;
              }
            }
          }
        }
      }

      // Best-effort: bootstrap personal taxonomy once enough summaries exist.
      void AITaxonomyService.ensureBootstrap().catch(e =>
        reportError(e, { action: '[useEmbeddingIndexer] taxonomy bootstrap failed' }),
      );
      // Rebuild temporal threads
      void import('../services/AIThreadService').then(({ AIThreadService }) => {
        void AIThreadService.rebuildThreads().catch(e =>
          reportError(e, { action: '[useEmbeddingIndexer] thread rebuild failed' }),
        );
      });
      // Best-effort: push any local-only embeddings to the cloud (no AI calls).
      // Succeeds only when E2E is unlocked; otherwise stays local for next time.
      await AIEmbeddingService.syncPendingToCloud();
    } catch (e) {
      reportError(e, { action: '[useEmbeddingIndexer] batch error' });
    } finally {
      runningRef.current = false;
    }
  }, [scheduleResummarize, scheduleWordCloudRebuild]);

  const scheduleIdle = useCallback(() => {
    if (typeof window === 'undefined' || !('requestIdleCallback' in window)) {
      timerRef.current = setTimeout(() => { void runBatch(); }, IDLE_TIMEOUT_MS);
      return;
    }
    (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout?: number }) => number })
      .requestIdleCallback(() => { void runBatch(); }, { timeout: IDLE_TIMEOUT_MS });
  }, [runBatch]);

  const scheduleDebounced = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void runBatch();
    }, DEBOUNCE_MS);
  }, [runBatch]);

  useEffect(() => {
    scheduleIdle();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleIdle();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    pollRef.current = setInterval(() => {
      scheduleIdle();
    }, POLL_INTERVAL_MS);

    window.addEventListener('storage', scheduleDebounced);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', scheduleDebounced);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (resummarizeTimerRef.current) clearTimeout(resummarizeTimerRef.current);
      if (wordCloudTimerRef.current) clearTimeout(wordCloudTimerRef.current);
    };
  }, [scheduleIdle, scheduleDebounced]);
}
