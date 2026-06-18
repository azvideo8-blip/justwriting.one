import { useRef, useEffect, useCallback } from 'react';
import { findStaleDocuments, indexDocument } from '../utils/embeddingIndexer';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIProfileFacetService } from '../services/AIProfileFacetService';
import { rebuildWordCloud } from '../../archive/hooks/useArchiveWordCloud';

const BATCH_SIZE = 3;
const DEBOUNCE_MS = 30_000;
const RESUMMARIZE_DEBOUNCE_MS = 60_000;
const BACKOFF_MS: Record<string, number> = {
  DAILY_LIMIT: 300_000,
  RATE_LIMIT: 60_000,
};
const IDLE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 120_000;

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
      void rebuildWordCloud().catch(e => console.warn('[useEmbeddingIndexer] word cloud rebuild failed:', e));
    }, 8_000);
  }, []);

  const scheduleResummarize = useCallback(() => {
    dirtyCountRef.current += 1;
    if (resummarizeTimerRef.current) clearTimeout(resummarizeTimerRef.current);
    resummarizeTimerRef.current = setTimeout(() => {
      void AIProfileFacetService.resummarizeDirty().then(r => {
        console.warn(`[useEmbeddingIndexer] resummarized ${r.count} dirty facets`);
        dirtyCountRef.current = 0;
      }).catch(e => {
        console.warn('[useEmbeddingIndexer] resummarize failed:', e);
      });
    }, RESUMMARIZE_DEBOUNCE_MS);
  }, []);

  const runBatch = useCallback(async () => {
    if (runningRef.current) return;
    const now = Date.now();
    if (now < backoffUntilRef.current) return;

    runningRef.current = true;
    try {
      const staleIds = await findStaleDocuments();
      const batch = staleIds.slice(0, BATCH_SIZE);

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
          void AIProfileFacetService.incrementalUpdate(docId).then(() => {
            scheduleResummarize();
          }).catch(e =>
            console.error('[useEmbeddingIndexer] incremental facet update failed:', e),
          );
          scheduleWordCloudRebuild();
        }
      }
      // Best-effort: push any local-only embeddings to the cloud (no AI calls).
      // Succeeds only when E2E is unlocked; otherwise stays local for next time.
      await AIEmbeddingService.syncPendingToCloud();
    } catch (e) {
      console.error('[useEmbeddingIndexer] batch error:', e);
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
