import { getLocalDb } from '../../../core/storage/localDb';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIService } from '../services/AIService';

export const CURRENT_EMBED_MODEL = 'fireworks/qwen3-embedding-8b';
export const CURRENT_EMBED_DIM = 1024;

export type IndexResult = 'ok' | 'skip' | 'rate' | 'daily' | 'error';

export async function sha256Hex(text: string): Promise<string> {
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

/** Document ids that have no embedding, or one from an outdated model/dimension. */
export async function findStaleDocuments(): Promise<string[]> {
  const db = await getLocalDb();
  const documents = await db.getAll('documents');
  const embeddings = await AIEmbeddingService.getAll();
  const embMap = new Map(embeddings.map(e => [e.documentId, e]));

  const stale: string[] = [];
  for (const doc of documents) {
    const emb = embMap.get(doc.id);
    if (!emb || emb.model !== CURRENT_EMBED_MODEL || emb.dim !== CURRENT_EMBED_DIM) {
      stale.push(doc.id);
    }
  }
  return stale;
}

export async function indexDocument(documentId: string): Promise<IndexResult> {
  const content = await getLatestContent(documentId);
  if (!content || content.trim().length === 0) return 'skip';

  const hash = await sha256Hex(content);
  // Local-only freshness check: never hit the cloud in the indexing loop — a
  // cloud read can throw (permissions before rules deploy, or LOCKED decrypt
  // when E2E is locked) and would break the whole batch. findStaleDocuments
  // already works off the local store.
  const db = await getLocalDb();
  const existing = await db.get('aiEmbeddings', documentId);
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

export interface IndexCoverage {
  totalDocs: number;
  indexed: number;
  stale: number;
  model: string;
  dim: number;
  lastProcessedAt: number | null;
}

/** Snapshot of how much of the corpus is indexed with the current model. */
export async function getIndexCoverage(): Promise<IndexCoverage> {
  const db = await getLocalDb();
  const documents = await db.getAll('documents');
  const embeddings = await AIEmbeddingService.getAll();
  const current = embeddings.filter(e => e.model === CURRENT_EMBED_MODEL && e.dim === CURRENT_EMBED_DIM);
  const lastProcessedAt = current.length > 0 ? Math.max(...current.map(e => e.processedAt)) : null;
  const stale = await findStaleDocuments();
  return {
    totalDocs: documents.length,
    indexed: current.length,
    stale: stale.length,
    model: CURRENT_EMBED_MODEL,
    dim: CURRENT_EMBED_DIM,
    lastProcessedAt,
  };
}

export interface IndexRunSummary {
  ok: number;
  skipped: number;
  failed: number;
  stopped: 'rate' | 'daily' | null;
}

/**
 * Indexes pending documents until done or `limit` is reached. Stops early on a
 * rate/daily limit. `onProgress(done, total, lastResult)` fires after each doc.
 */
export async function indexPending(opts?: {
  limit?: number;
  onProgress?: (done: number, total: number, lastResult: IndexResult) => void;
}): Promise<IndexRunSummary> {
  const stale = await findStaleDocuments();
  const targets = opts?.limit ? stale.slice(0, opts.limit) : stale;
  const summary: IndexRunSummary = { ok: 0, skipped: 0, failed: 0, stopped: null };

  for (let i = 0; i < targets.length; i++) {
    const result = await indexDocument(targets[i]!);
    if (result === 'ok') summary.ok++;
    else if (result === 'skip') summary.skipped++;
    else if (result === 'error') summary.failed++;
    else if (result === 'daily' || result === 'rate') {
      summary.stopped = result;
      opts?.onProgress?.(i + 1, targets.length, result);
      break;
    }
    opts?.onProgress?.(i + 1, targets.length, result);
  }
  return summary;
}
