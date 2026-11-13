import { getLocalDb } from '../../../core/storage/localDb';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIService } from '../services/AIService';
import { getCurrentUser } from '../../../core/auth';
import { hasIndexingConsent } from '../../../core/ai/indexingConsent';
import { isDayLimitError } from '../types/aiErrors';
import { isExcludedFromAI } from './isExcludedFromAI';
import { isEmbeddingDownloadPending } from '../services/embeddingRestoreState';

// docs/plan-2026-09-19-local-embeddings.md: embeddings moved off RouterAI to a
// local CPU server (chat is unaffected, still RouterAI) — BAAI/bge-m3 is
// 1024-dim, different from the old qwen3-embedding-8b's 4096. The (model,
// dim) mismatch alone marks every existing embedding stale, which is
// intentional: vectors from different models/dims aren't comparable, so a
// full re-index is required after this provider switch.
export const CURRENT_EMBED_MODEL = 'BAAI/bge-m3';
export const CURRENT_EMBED_DIM = 1024;
// Embedding pipeline version. v2 = per-chunk vectors; v3 = also stores chunk
// texts (for chunk-level profile domains). Bumping forces a full re-index.
export const CURRENT_EMBED_SCHEMA = 3;

export type IndexResult = 'ok' | 'skip' | 'rate' | 'daily' | 'error';

/** True when a stored embedding matches the current model/dim/schema. */
export function isEmbeddingFresh(emb: { model: string; dim: number; schemaV?: number } | undefined): boolean {
  return !!emb && emb.model === CURRENT_EMBED_MODEL && emb.dim === CURRENT_EMBED_DIM && emb.schemaV === CURRENT_EMBED_SCHEMA;
}

export async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function findStaleDocuments(): Promise<string[]> {
  const db = await getLocalDb();
  const documents = await db.getAll('documents');
  const embeddings = await AIEmbeddingService.getAll();
  const embMap = new Map(embeddings.map(e => [e.documentId, e]));
  // AN-1 (владелец 13.11): вектор — только у разобранной заметки; без разбора
  // она к ИИ не уходит. Неразобранная — не «ждёт вектора».
  const analysed = new Set((await db.getAllKeys('aiSummaries')).map(String));

  const stale: string[] = [];
  for (const doc of documents) {
    if (isExcludedFromAI(doc) || !analysed.has(doc.id)) continue;
    if (!isEmbeddingFresh(embMap.get(doc.id))) {
      stale.push(doc.id);
    }
  }
  return stale;
}

export async function indexDocument(documentId: string, force = false): Promise<IndexResult> {
  const uid = getCurrentUser()?.uid;
  if (!hasIndexingConsent(uid)) {
    return 'skip';
  }

  const db = await getLocalDb();

  const doc = await db.get('documents', documentId);
  if (isExcludedFromAI(doc)) {
    return 'skip';
  }
  // AN-1 (владелец 13.11): «ИИ не видит заметку, пока вы её не разобрали» —
  // правда для всех путей: согласие на поиск, догрузка после разбора архива,
  // «пересчитать всё». Текст неразобранной заметки на векторы не уходит.
  // Разбор пишет сводку раньше вектора (NoteAnalysisService), так что свой путь не режет.
  if (!(await db.get('aiSummaries', documentId))) {
    return 'skip';
  }

  const content = await LocalVersionService.getLatestContent(documentId);
  if (!content || content.trim().length === 0) return 'skip';

  const hash = await sha256Hex(content);
  // Local-only freshness check: never hit the cloud in the indexing loop — a
  // cloud read can throw (permissions before rules deploy, or LOCKED decrypt
  // when E2E is locked) and would break the whole batch. findStaleDocuments
  // already works off the local store. `force` re-embeds even if fresh.
  const existing = await db.get('aiEmbeddings', documentId);
  if (!force && existing && existing.contentHash === hash && isEmbeddingFresh(existing)) {
    return 'skip';
  }

  if (content.length > 200_000) {
    await AIEmbeddingService.save({
      documentId,
      vectors: [],
      chunkTexts: [],
      model: CURRENT_EMBED_MODEL,
      dim: CURRENT_EMBED_DIM,
      contentHash: hash,
      processedAt: Date.now(),
      schemaV: CURRENT_EMBED_SCHEMA,
      cloudSkipped: true,
    });
    return 'skip';
  }

  // Ревью AP2: заметку могли скрыть, пока читался текст, — провайдер его не получает.
  if (isExcludedFromAI(await db.get('documents', documentId))) return 'skip';
  const result = await AIService.embed({ content });
  if (!result.ok) {
    if (isDayLimitError(result.error)) return 'daily';
    if (result.error === 'RATE_LIMIT') return 'rate';
    if (result.error === 'TOO_LONG' || result.error === 'INVALID_ARGUMENT') {
      await AIEmbeddingService.save({
        documentId,
        vectors: [],
        chunkTexts: [],
        model: CURRENT_EMBED_MODEL,
        dim: CURRENT_EMBED_DIM,
        contentHash: hash,
        processedAt: Date.now(),
        schemaV: CURRENT_EMBED_SCHEMA,
        cloudSkipped: true,
      });
      return 'skip';
    }
    return 'error';
  }

  await AIEmbeddingService.save({
    documentId,
    vectors: result.vectors,
    chunkTexts: result.chunks,
    model: result.model,
    dim: result.dim,
    contentHash: hash,
    processedAt: Date.now(),
    schemaV: CURRENT_EMBED_SCHEMA,
  });
  return 'ok';
}

export interface IndexCoverage {
  totalDocs: number;
  indexed: number;
  stale: number;
  /** Local embeddings not yet written to the cloud (e.g. made while E2E locked). */
  unsynced: number;
  model: string;
  dim: number;
  lastProcessedAt: number | null;
}

/** Snapshot of how much of the corpus is indexed with the current model. */
export async function getIndexCoverage(): Promise<IndexCoverage> {
  const db = await getLocalDb();
  const documents = await db.getAll('documents');
  // Only notes the AI may see are indexable, so they are the only ones counted
  // in the denominator — otherwise hidden/trashed notes keep coverage below 100%
  // forever. A stale vector left on such a note isn't counted as indexed either.
  const indexable = new Set(documents.filter(d => !isExcludedFromAI(d)).map(d => d.id));
  const embeddings = await AIEmbeddingService.getAll();
  const current = embeddings.filter(e => isEmbeddingFresh(e) && indexable.has(e.documentId));
  const lastProcessedAt = current.length > 0 ? Math.max(...current.map(e => e.processedAt)) : null;
  const stale = await findStaleDocuments();
  const unsynced = embeddings.filter(e => !e.cloudSyncedAt && !e.cloudSkipped).length;
  return {
    totalDocs: indexable.size,
    indexed: current.length,
    stale: stale.length,
    unsynced,
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

type ProgressFn = (done: number, total: number, lastResult: IndexResult) => void;

async function runIndex(ids: string[], force: boolean, onProgress?: ProgressFn): Promise<IndexRunSummary> {
  const summary: IndexRunSummary = { ok: 0, skipped: 0, failed: 0, stopped: null };
  for (let i = 0; i < ids.length; i++) {
    const result = await indexDocument(ids[i]!, force);
    if (result === 'ok') summary.ok++;
    else if (result === 'skip') summary.skipped++;
    else if (result === 'error') summary.failed++;
    else if (result === 'daily' || result === 'rate') {
      summary.stopped = result;
      onProgress?.(i + 1, ids.length, result);
      break;
    }
    onProgress?.(i + 1, ids.length, result);
    // Gentle spacing between real embed calls so a large backlog doesn't burst
    // the provider (skips are local and instant — no need to wait).
    if (result === 'ok' && i < ids.length - 1) {
      await new Promise(r => setTimeout(r, 150));
    }
  }
  return summary;
}

/**
 * Indexes pending (stale) documents until done or `limit` is reached. Stops
 * early on a rate/daily limit. `onProgress(done, total, lastResult)` fires per doc.
 */
export async function indexPending(opts?: {
  limit?: number;
  onProgress?: ProgressFn;
}): Promise<IndexRunSummary> {
  const uid = getCurrentUser()?.uid;
  if (!hasIndexingConsent(uid)) {
    const stale = await findStaleDocuments();
    return { ok: 0, skipped: stale.length, failed: 0, stopped: null };
  }
  const stale = await findStaleDocuments();
  // П-6 (замер 08.10.2026): пока автоматическая догрузка векторов из облака не
  // дошла до конца, заметку БЕЗ локальной записи не пересчитываем — её вектор
  // лежит в облаке и доедет дешёвым чтением. Заметку с устаревшей Локальной
  // записью трогаем как раньше: облачная копия такой заметки могла быть посчитана
  // с другого текста, и ждать её незачем.
  const waiting = isEmbeddingDownloadPending(uid ?? 'guest');
  let pending = stale;
  if (waiting) {
    const db = await getLocalDb();
    const haveLocal = new Set((await db.getAllKeys('aiEmbeddings')).map(String));
    pending = stale.filter(id => haveLocal.has(id));
  }
  const targets = opts?.limit ? pending.slice(0, opts.limit) : pending;
  return runIndex(targets, false, opts?.onProgress);
}

/** Force re-embed of EVERY document (ignores freshness) — full rebuild. */
export async function reindexAll(opts?: { onProgress?: ProgressFn }): Promise<IndexRunSummary> {
  const uid = getCurrentUser()?.uid;
  if (!hasIndexingConsent(uid)) {
    const db = await getLocalDb();
    const count = await db.count('documents');
    return { ok: 0, skipped: count, failed: 0, stopped: null };
  }
  const db = await getLocalDb();
  const ids = (await db.getAll('documents')).map(d => d.id);
  return runIndex(ids, true, opts?.onProgress);
}
