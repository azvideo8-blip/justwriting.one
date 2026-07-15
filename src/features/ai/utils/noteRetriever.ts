import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIService } from '../services/AIService';
import { getLocalDb } from '../../../core/storage/localDb';
import { LocalVersionService } from '../../../core/services/LocalVersionService';
import { topKMultiWithChunkIndex } from '../utils/vectorSearch';
import MiniSearch from 'minisearch';
import { reportError } from '../../../shared/errors/reportError';

export interface RetrievedNote {
  documentId: string;
  title: string;
  content: string;
  score: number;
  chunkIndex?: number | undefined;
  lastSessionAt?: number | undefined;
}

const RRF_K = 60;
const VECTOR_TOP = 40;
const KEYWORD_TOP = 40;
const RRF_FINAL = 15;
const RERANK_THRESHOLD = 0.88;

interface CacheResultEntry {
  documentId: string;
  score: number;
  chunkIndex?: number | undefined;
}

// TICKET-047: In-memory semantic query cache
interface SearchCacheEntry {
  timestamp: number;
  query: string;
  results: CacheResultEntry[];
}
const searchCache: SearchCacheEntry[] = [];
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

let miniSearchInstance: MiniSearch | null = null;
let miniSearchBuiltAt = 0;

async function getMiniSearch(): Promise<MiniSearch> {
  if (miniSearchInstance && Date.now() - miniSearchBuiltAt < CACHE_TTL_MS) return miniSearchInstance;
  const db = await getLocalDb();
  const docs = await db.getAll('documents');
  const entries: { id: string; title: string; content: string }[] = [];
  for (const doc of docs) {
    const content = await LocalVersionService.getLatestContent(doc.id);
    if (!content) continue;
    entries.push({
      id: doc.id,
      title: doc.title ?? '',
      content: content.slice(0, 10_000),
    });
  }
  miniSearchInstance = new MiniSearch({
    fields: ['title', 'content'],
    storeFields: [],
    searchOptions: {
      prefix: true,
      combineWith: 'OR',
      fuzzy: 0.2,
    },
  });
  await miniSearchInstance.addAllAsync(entries);
  miniSearchBuiltAt = Date.now();
  return miniSearchInstance;
}

/** BM25 keyword search via MiniSearch with prefix + fuzzy support. */
async function keywordSearch(query: string, topN: number): Promise<{ id: string; score: number }[]> {
  try {
    const ms = await getMiniSearch();
    const results = ms.search(query);
    return results.slice(0, topN).map(r => ({ id: r.id as string, score: r.score }));
  } catch {
    return [];
  }
}

/** Reciprocal Rank Fusion: combine two ranked lists into one.
 *  TICKET-045: supports keywordWeight to boost exact-term matches. */
function reciprocalRankFusion(
  vectorRanked: { id: string; score: number }[],
  keywordRanked: { id: string; score: number }[],
  k: number,
  keywordWeight = 1.0,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();

  for (let rank = 0; rank < vectorRanked.length; rank++) {
    const id = vectorRanked[rank]!.id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
  }

  for (let rank = 0; rank < keywordRanked.length; rank++) {
    const id = keywordRanked[rank]!.id;
    scores.set(id, (scores.get(id) ?? 0) + (1 / (k + rank)) * keywordWeight);
  }

  const result = [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);

  return result;
}

// TICKET-045: Detect proper names or quoted terms in the query
function shouldBoostKeywords(query: string): boolean {
  const hasNames = /[А-ЯЁ][а-яё]{2,}/.test(query);
  const hasQuotes = /["'«»]/.test(query);
  return hasNames || hasQuotes;
}

// TICKET-046: Check for exact title match to bypass rerank
function hasExactTitleMatch(query: string, topIds: string[]): Promise<boolean> {
  return (async () => {
    const db = await getLocalDb();
    const qLower = query.trim().toLowerCase();
    for (const id of topIds.slice(0, 5)) {
      const doc = await db.get('documents', id);
      if (doc?.title?.trim().toLowerCase() === qLower) return true;
    }
    return false;
  })();
}

type EmbeddingEntry = Awaited<ReturnType<typeof AIEmbeddingService.getAll>>[number];

export async function searchNotes(query: string, maxResults = 5, opts?: { queryVector?: number[] | undefined; allEmbeddings?: EmbeddingEntry[] | undefined; minTime?: number | undefined; maxTime?: number | undefined; ignoredDocIds?: Set<string> | undefined }): Promise<RetrievedNote[]> {
  let queryVec = opts?.queryVector;
  if (!queryVec) {
    const embedResult = await AIService.embed({ content: query });
    if (!embedResult.ok) {
      reportError(embedResult.error, { action: 'search_notes_embed' });
      return [];
    }
    queryVec = embedResult.vectors[0];
  }
  if (!queryVec) return [];

  let filteredEmbeddings = opts?.allEmbeddings ?? await AIEmbeddingService.getAll();
  const db = await getLocalDb();
  if (opts?.minTime !== undefined || opts?.maxTime !== undefined || opts?.ignoredDocIds !== undefined) {
    const allowed = new Set<string>();
    const docs = await db.getAll('documents');
    for (const doc of docs) {
      if (opts?.ignoredDocIds?.has(doc.id)) continue;
      const ts = doc.lastSessionAt;
      if (ts && (opts.minTime === undefined || ts >= opts.minTime) && (opts.maxTime === undefined || ts <= opts.maxTime)) {
        allowed.add(doc.id);
      }
    }
    filteredEmbeddings = filteredEmbeddings.filter(e => allowed.has(e.documentId));
  }

  if (filteredEmbeddings.length === 0) return [];

  const vectorMatches = topKMultiWithChunkIndex(
    queryVec,
    filteredEmbeddings.map(e => ({
      id: e.documentId,
      vectors: e.vectors?.length ? e.vectors : (e.vector ? [e.vector] : []),
    })),
    VECTOR_TOP,
  );

  let keywordMatches = await keywordSearch(query, KEYWORD_TOP);
  if (opts?.minTime !== undefined || opts?.maxTime !== undefined || opts?.ignoredDocIds !== undefined) {
    const allowed = new Set<string>();
    const docs = await db.getAll('documents');
    for (const doc of docs) {
      if (opts?.ignoredDocIds?.has(doc.id)) continue;
      const ts = doc.lastSessionAt;
      if (ts && (opts.minTime === undefined || ts >= opts.minTime) && (opts.maxTime === undefined || ts <= opts.maxTime)) {
        allowed.add(doc.id);
      }
    }
    keywordMatches = keywordMatches.filter(m => allowed.has(m.id));
  }

  // TICKET-045: Boost keyword matches if query contains proper names or quotes
  const kwWeight = shouldBoostKeywords(query) ? 2.0 : 1.0;

  // RRF fusion (strip chunkIndex for RRF, keep map for later)
  const chunkIndexMap = new Map(vectorMatches.map(m => [m.id, m.chunkIndex]));
  const fused = reciprocalRankFusion(
    vectorMatches.map(({ id, score }) => ({ id, score })),
    keywordMatches,
    RRF_K,
    kwWeight,
  );
  const topIds = fused.slice(0, RRF_FINAL).map(f => f.id);

  // TICKET-046: Bypass cloud rerank if top vector similarity is very high
  // or there's an exact title match
  const topScore = vectorMatches[0]?.score ?? 0;
  const hasExactTitle = await hasExactTitleMatch(query, topIds);
  if (topScore >= RERANK_THRESHOLD || hasExactTitle) {
    const scoreMap = new Map(fused.map(f => [f.id, f.score]));
    const fallbackIds = topIds.slice(0, maxResults);
    return loadNotes(fallbackIds, scoreMap, chunkIndexMap);
  }

  // Build rerank cards from LOCAL summaries
  const cardsDb = await getLocalDb();
  const cards: { documentId: string; card: string }[] = [];
  for (const id of topIds) {
    let card = '(саммари недоступно)';
    try {
      const summary = await cardsDb.get('aiSummaries', id);
      if (summary) {
        const parts = [];
        if (summary.summary) parts.push(summary.summary);
        if (summary.tone) parts.push(`Тональность: ${summary.tone}`);
        if (summary.themes?.length) parts.push(`Темы: ${summary.themes.join(', ')}`);
        if (summary.insights?.length) parts.push(`Инсайты: ${summary.insights.join('; ')}`);
        if (summary.extractedFacts?.length) parts.push(`Факты: ${summary.extractedFacts.join('; ')}`);
        card = parts.join('\n');
      }
    } catch { /* keep placeholder */ }
    cards.push({ documentId: id, card });
  }

  // Rerank via the dedicated rerankNotes endpoint
  const fallbackIds = topIds.slice(0, maxResults);
  const rr = await AIService.rerank({
    query,
    candidates: cards,
    maxResults,
  });

  const ids = rr.ok && rr.documentIds.length > 0 ? rr.documentIds.slice(0, maxResults) : fallbackIds;

  const scoreMap = new Map(fused.map(f => [f.id, f.score]));
  return loadNotes(ids, scoreMap, chunkIndexMap);
}

/** Loads title + chunk context for the given document ids, preserving order.
 *  TICKET-023: For notes with chunk embeddings, loads only the matching chunk
 *  + its neighbours instead of the full note content. */
async function loadNotes(
  ids: string[],
  scoreMap: Map<string, number>,
  chunkIndexMap?: Map<string, number>,
): Promise<RetrievedNote[]> {
  const results: RetrievedNote[] = [];
  const db = await getLocalDb();
  for (const docId of ids) {
    const doc = await db.get('documents', docId);
    if (!doc) continue;
    const chunkIdx = chunkIndexMap?.get(docId);

    let content = '';
    let noteChunkIndex: number | undefined;

    // Parent Document Retrieval: load chunk ± neighbours from stored chunk texts.
    // Falls back to O(1) getLatestContent — avoids loading all version records.
    if (chunkIdx !== undefined && chunkIdx >= 0) {
      const emb = await AIEmbeddingService.get(docId);
      const chunkTexts = emb?.chunkTexts;
      if (chunkTexts && chunkTexts.length > 1) {
        noteChunkIndex = chunkIdx;
        const parts: string[] = [];
        if (chunkIdx > 0 && chunkTexts[chunkIdx - 1]) parts.push(chunkTexts[chunkIdx - 1]!);
        if (chunkTexts[chunkIdx]) parts.push(chunkTexts[chunkIdx]!);
        if (chunkIdx < chunkTexts.length - 1 && chunkTexts[chunkIdx + 1]) parts.push(chunkTexts[chunkIdx + 1]!);
        content = parts.join('\n\n');
      }
    }
    if (!content) {
      content = await LocalVersionService.getLatestContent(docId);
    }
    if (!content) continue;

    results.push({
      documentId: docId,
      title: doc.title || 'Без названия',
      content,
      score: scoreMap.get(docId) ?? 0,
      chunkIndex: noteChunkIndex,
      lastSessionAt: doc.lastSessionAt,
    });
  }
  return results;
}

// TICKET-047: Cache helpers
function cleanCache() {
  const limit = Date.now() - CACHE_TTL_MS;
  while (searchCache.length > 0 && searchCache[0]!.timestamp < limit) {
    searchCache.shift();
  }
}

function getCached(query: string): CacheResultEntry[] | null {
  const q = query.trim().toLowerCase();
  const entry = searchCache.find(c => c.query.trim().toLowerCase() === q);
  return entry ? entry.results : null;
}

function putCache(query: string, results: RetrievedNote[]) {
  if (searchCache.length >= MAX_CACHE_ENTRIES) {
    searchCache.shift();
  }
  const cachedResults: CacheResultEntry[] = results.map(r => ({
    documentId: r.documentId,
    score: r.score,
    chunkIndex: r.chunkIndex,
  }));
  searchCache.push({ timestamp: Date.now(), query, results: cachedResults });
}

/**
 * TICKET-044: Consolidated multi-query search — single embedding + single rerank.
 * TICKET-045: Entity-aware keyword boosting in RRF fusion.
 * TICKET-046: Threshold-based cloud rerank bypassing.
 * TICKET-047: In-memory semantic query caching.
 */
export async function searchNotesMulti(
  queries: string[],
  maxResults = 5,
  opts?: { queryVector?: number[] | undefined; allEmbeddings?: EmbeddingEntry[] | undefined; minTime?: number | undefined; maxTime?: number | undefined; ignoredDocIds?: Set<string> | undefined },
): Promise<RetrievedNote[]> {
  if (queries.length === 0) return [];

  // TICKET-047: Check cache before any network calls
  cleanCache();
  const cacheKey = [...queries].sort().join('\x00');
  const cached = getCached(cacheKey);
  if (cached) {
    const ids = cached.map(c => c.documentId);
    const scoreMap = new Map(cached.map(c => [c.documentId, c.score]));
    const chunkIndexMap = new Map(cached.map(c => [c.documentId, c.chunkIndex]));
    const cleanChunkIdx = new Map<string, number>();
    for (const [id, idx] of chunkIndexMap.entries()) {
      if (idx !== undefined) cleanChunkIdx.set(id, idx);
    }
    return loadNotes(ids, scoreMap, cleanChunkIdx);
  }

  if (queries.length === 1) {
    const results = await searchNotes(queries[0]!, maxResults, opts);
    putCache(cacheKey, results);
    return results;
  }

  // OPT-1: Reuse pre-computed query vector if provided
  let queryVec = opts?.queryVector;
  if (!queryVec) {
    // TICKET-044 & T-6: Consolidate all queries into a single embedding, weighting by turn age
    const weightedParts: string[] = [];
    queries.forEach((q, idx) => {
      const weight = Math.max(1, 3 - idx);
      for (let i = 0; i < weight; i++) {
        weightedParts.push(q);
      }
    });
    const combinedQuery = weightedParts.join(' ');
    const embedResult = await AIService.embed({ content: combinedQuery });
    if (!embedResult.ok) {
      reportError(embedResult.error, { action: 'search_notes_multi_embed' });
      return [];
    }
    queryVec = embedResult.vectors[0];
  }
  if (!queryVec) return [];

  const db = await getLocalDb();
  let filteredEmbeddings = opts?.allEmbeddings ?? await AIEmbeddingService.getAll();
  if (opts?.minTime !== undefined || opts?.maxTime !== undefined || opts?.ignoredDocIds !== undefined) {
    const allowed = new Set<string>();
    const docs = await db.getAll('documents');
    for (const doc of docs) {
      if (opts?.ignoredDocIds?.has(doc.id)) continue;
      const ts = doc.lastSessionAt;
      if (ts && (opts.minTime === undefined || ts >= opts.minTime) && (opts.maxTime === undefined || ts <= opts.maxTime)) {
        allowed.add(doc.id);
      }
    }
    filteredEmbeddings = filteredEmbeddings.filter(e => allowed.has(e.documentId));
  }

  if (filteredEmbeddings.length === 0) return [];

  // Single vector search with combined embedding
  const vectorMatches = topKMultiWithChunkIndex(
    queryVec,
    filteredEmbeddings.map(e => ({
      id: e.documentId,
      vectors: e.vectors?.length ? e.vectors : (e.vector ? [e.vector] : []),
    })),
    VECTOR_TOP,
  );

  // TICKET-044 & T-6: Run keyword searches for each query and merge with turn-decay weighting
  const keywordScores = new Map<string, number>();
  let queryIdx = 0;
  for (const q of queries) {
    let kwResults = await keywordSearch(q, KEYWORD_TOP);
    const decay = Math.pow(0.5, queryIdx);
    queryIdx++;
    if (opts?.minTime !== undefined || opts?.maxTime !== undefined || opts?.ignoredDocIds !== undefined) {
      const allowed = new Set<string>();
      const docs = await db.getAll('documents');
      for (const doc of docs) {
        if (opts?.ignoredDocIds?.has(doc.id)) continue;
        const ts = doc.lastSessionAt;
        if (ts && (opts.minTime === undefined || ts >= opts.minTime) && (opts.maxTime === undefined || ts <= opts.maxTime)) {
          allowed.add(doc.id);
        }
      }
      kwResults = kwResults.filter(r => allowed.has(r.id));
    }
    for (const { id, score } of kwResults) {
      const decayedScore = score * decay;
      const existing = keywordScores.get(id);
      if (existing === undefined || decayedScore > existing) {
        keywordScores.set(id, decayedScore);
      }
    }
  }
  const mergedKeyword = [...keywordScores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);

  // TICKET-045: Boost keywords if original query has names/quotes
  const kwWeight = shouldBoostKeywords(queries[0]!) ? 2.0 : 1.0;

  // RRF fusion
  const chunkIndexMap = new Map(vectorMatches.map(m => [m.id, m.chunkIndex]));
  const fused = reciprocalRankFusion(
    vectorMatches.map(({ id, score }) => ({ id, score })),
    mergedKeyword,
    RRF_K,
    kwWeight,
  );
  const topIds = fused.slice(0, RRF_FINAL).map(f => f.id);

  // TICKET-046 & T-3: Bypass cloud rerank if top vector similarity is very high,
  // there is an exact title match, quote match, or named entity match
  const topScore = vectorMatches[0]?.score ?? 0;
  const hasExactTitle = await hasExactTitleMatch(queries[0]!, topIds);

  // T-3: local high-confidence signal — an exact quote or named-entity hit in a
  // candidate's content. Collect the matching ids so we can lift them, not just bypass.
  const matchedIds = new Set<string>();
  const quotes = extractQuotes(queries[0]!);
  const entities = extractNamedEntities(queries[0]!);
  if (quotes.length > 0 || entities.length > 0) {
    for (const id of topIds) {
      let content = '';
      try { content = await LocalVersionService.getLatestContent(id); } catch { /* ignore */ }
      if (!content) continue;
      const lc = content.toLowerCase();
      if (quotes.some(q => lc.includes(q)) || entities.some(e => lc.includes(e))) {
        matchedIds.add(id);
      }
    }
  }

  // Bypass the cloud rerank when a strong local signal exists, and lift local
  // matches to the front (stable — the fused order is preserved otherwise).
  if (topScore >= RERANK_THRESHOLD || hasExactTitle || matchedIds.size > 0) {
    const scoreMap = new Map(fused.map(f => [f.id, f.score]));
    const ordered = [...topIds].sort(
      (a, b) => (matchedIds.has(b) ? 1 : 0) - (matchedIds.has(a) ? 1 : 0),
    );
    const fallbackIds = ordered.slice(0, maxResults);
    const results = await loadNotes(fallbackIds, scoreMap, chunkIndexMap);
    putCache(cacheKey, results);
    return results;
  }

  // Build rerank cards from LOCAL summaries
  const cardsDb = await getLocalDb();
  const cards: { documentId: string; card: string }[] = [];
  for (const id of topIds) {
    let card = '(саммари недоступно)';
    try {
      const summary = await cardsDb.get('aiSummaries', id);
      const parts = [];
      if (summary) {
        if (summary.summary) parts.push(summary.summary);
        if (summary.tone) parts.push(`Тональность: ${summary.tone}`);
        if (summary.themes?.length) parts.push(`Темы: ${summary.themes.join(', ')}`);
        if (summary.insights?.length) parts.push(`Инсайты: ${summary.insights.join('; ')}`);
        if (summary.extractedFacts?.length) parts.push(`Факты: ${summary.extractedFacts.join('; ')}`);
      }

      const chunkIdx = chunkIndexMap.get(id);
      let excerpt = '';
      if (chunkIdx !== undefined && chunkIdx >= 0) {
        try {
          const emb = await AIEmbeddingService.get(id);
          const matchedText = emb?.chunkTexts?.[chunkIdx];
          if (matchedText) {
            excerpt = matchedText.slice(0, 350);
          }
        } catch { /* ignore */ }
      }

      if (!excerpt) {
        try {
          const content = await LocalVersionService.getLatestContent(id);
          if (content) {
            excerpt = content.slice(0, 350);
          }
        } catch { /* ignore */ }
      }

      if (excerpt) {
        parts.push(`Фрагмент: "${excerpt}"`);
      }

      if (parts.length > 0) {
        card = parts.join('\n');
      }
    } catch { /* keep placeholder */ }
    cards.push({ documentId: id, card });
  }

  // TICKET-044: Single rerank call using original query
  const fallbackIds = topIds.slice(0, maxResults);
  const rr = await AIService.rerank({
    query: queries[0]!,
    candidates: cards,
    maxResults,
  });

  const ids = rr.ok && rr.documentIds.length > 0 ? rr.documentIds.slice(0, maxResults) : fallbackIds;

  const scoreMap = new Map(fused.map(f => [f.id, f.score]));
  const results = await loadNotes(ids, scoreMap, chunkIndexMap);

  // TICKET-047: Cache results
  putCache(cacheKey, results);
  return results;
}

function extractQuotes(text: string): string[] {
  const quotes: string[] = [];
  const regex = /["'«„]([^"'»“]+)["'»“]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]?.trim()) {
      quotes.push(match[1].trim().toLowerCase());
    }
  }
  return quotes;
}

function extractNamedEntities(query: string): string[] {
  const words = query.split(/[\s,.:;!?()"\-«»„“]+/);
  const entities: string[] = [];
  for (const w of words) {
    if (/^[А-ЯA-Z][а-яa-zа-яёА-ЯЁa-zA-Z]*$/.test(w)) {
      if (w.length >= 3) {
        entities.push(w.toLowerCase());
      }
    }
  }
  return entities;
}
