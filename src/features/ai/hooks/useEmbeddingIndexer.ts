import { useRef, useEffect, useCallback } from 'react';
import { getLocalDb } from '../../../core/storage/localDb';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIService } from '../services/AIService';

const CURRENT_EMBED_MODEL = 'fireworks/qwen3-embedding-8b';
const CURRENT_EMBED_DIM = 1024;
const BATCH_SIZE = 3;
const DEBOUNCE_MS = 30_000;
const BACKOFF_MS: Record<string, number> = {
  DAILY_LIMIT: 300_000,
  RATE_LIMIT: 60_000,
};
const IDLE_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 120_000;

async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getLatestContent(documentId: string): Promise<string | null> {
  const db = await getLocalDb();
  const versions = await db.getAllFromIndex('versions', 'by-document', documentId);
  if (versions.length === 0) return null;
  versions.sort((a, b) => b.version - a.version);
  return versions[0]?.content ?? null;
}

async function findStaleDocuments(): Promise<string[]> {
  const db = await getLocalDb();
  const documents = await db.getAll('documents');
  const embeddings = await AIEmbeddingService.getAll();
  const embMap = new Map(embeddings.map(e => [e.documentId, e]));

  const stale: string[] = [];
  for (const doc of documents) {
    const emb = embMap.get(doc.id);
    if (!emb) {
      stale.push(doc.id);
      continue;
    }
    if (emb.model !== CURRENT_EMBED_MODEL || emb.dim !== CURRENT_EMBED_DIM) {
      stale.push(doc.id);
      continue;
    }
  }
  return stale;
}

async function indexDocument(documentId: string): Promise<'ok' | 'skip' | 'rate' | 'daily' | 'error'> {
  const content = await getLatestContent(documentId);
  if (!content || content.trim().length === 0) return 'skip';

  const hash = await sha256Hex(content);
  const existing = await AIEmbeddingService.get(documentId);
  if (existing && existing.contentHash === hash && existing.model === CURRENT_EMBED_MODEL && existing.dim === CURRENT_EMBED_DIM) {
    return 'skip';
  }

  const result = await AIService.embed({ content });
  if (!result.ok) {
    if (result.error === 'DAILY_LIMIT') return 'daily';
    if (result.error === 'RATE_LIMIT') return 'rate';
    return 'error';
  }

  await AIEmbeddingService.save({
    documentId,
    vector: result.vector,
    model: result.model,
    dim: result.dim,
    contentHash: hash,
    processedAt: Date.now(),
  });
  return 'ok';
}

export function useEmbeddingIndexer(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffUntilRef = useRef<number>(0);
  const runningRef = useRef(false);

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
      }
    } catch (e) {
      console.error('[useEmbeddingIndexer] batch error:', e);
    } finally {
      runningRef.current = false;
    }
  }, []);

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
    };
  }, [scheduleIdle, scheduleDebounced]);
}
