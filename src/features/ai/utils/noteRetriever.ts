import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIService } from '../services/AIService';
import { getLocalDb } from '../../../core/storage/localDb';
import { topKMultiWithChunkIndex } from '../utils/vectorSearch';
import MiniSearch from 'minisearch';

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

// TICKET-047: In-memory semantic query cache
interface SearchCacheEntry {
  timestamp: number;
  query: string;
  results: RetrievedNote[];
}
const searchCache: SearchCacheEntry[] = [];
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

let miniSearchInstance: MiniSearch | null = null;

async function getMiniSearch(): Promise<MiniSearch> {
  if (miniSearchInstance) return miniSearchInstance;
  const db = await getLocalDb();
  const docs = await db.getAll('documents');
  const entries: { id: string; title: string; content: string }[] = [];
  for (const doc of docs) {
    const versions = await db.getAllFromIndex('versions', 'by-document', doc.id);
    if (versions.length === 0) continue;
    versions.sort((a, b) => b.version - a.version);
    entries.push({
      id: doc.id,
      title: doc.title ?? '',
      content: (versions[0]?.content ?? '').slice(0, 10_000),
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

export async function searchNotes(query: string, maxResults = 5): Promise<RetrievedNote[]> {
  const embedResult = await AIService.embed({ content: query });
  if (!embedResult.ok) {
    console.warn('[searchNotes] embed failed:', embedResult.error);
    return [];
  }
  const queryVec = embedResult.vectors[0];
  if (!queryVec) return [];

  const allEmbeddings = await AIEmbeddingService.getAll();
  if (allEmbeddings.length === 0) return [];

  // Vector search: top 40, with chunk index for Parent Document Retrieval
  const vectorMatches = topKMultiWithChunkIndex(
    queryVec,
    allEmbeddings.map(e => ({
      id: e.documentId,
      vectors: e.vectors?.length ? e.vectors : (e.vector ? [e.vector] : []),
    })),
    VECTOR_TOP,
  );

  // Keyword search: top 40
  const keywordMatches = await keywordSearch(query, KEYWORD_TOP);

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
        card = `Тональность: ${summary.tone}\nТемы: ${summary.themes.join(', ')}\nИнсайты: ${summary.insights.join('; ')}\nФакты: ${summary.extractedFacts.join('; ')}`;
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
    const versions = await db.getAllFromIndex('versions', 'by-document', docId);
    if (versions.length === 0) continue;
    versions.sort((a, b) => b.version - a.version);
    const fullContent = versions[0]?.content ?? '';
    const chunkIdx = chunkIndexMap?.get(docId);

    let content = fullContent;
    let noteChunkIndex: number | undefined;

    // Parent Document Retrieval: load chunk ± neighbours
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

function getCached(query: string): RetrievedNote[] | null {
  const q = query.trim().toLowerCase();
  const entry = searchCache.find(c => c.query.trim().toLowerCase() === q);
  return entry ? entry.results : null;
}

function putCache(query: string, results: RetrievedNote[]) {
  if (searchCache.length >= MAX_CACHE_ENTRIES) {
    searchCache.shift();
  }
  searchCache.push({ timestamp: Date.now(), query, results });
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
): Promise<RetrievedNote[]> {
  if (queries.length === 0) return [];

  // TICKET-047: Check cache before any network calls
  cleanCache();
  const cached = getCached(queries[0]!);
  if (cached) return cached;

  if (queries.length === 1) {
    const results = await searchNotes(queries[0]!, maxResults);
    putCache(queries[0]!, results);
    return results;
  }

  // TICKET-044: Consolidate all queries into a single embedding
  const combinedQuery = queries.join(' ');
  const embedResult = await AIService.embed({ content: combinedQuery });
  if (!embedResult.ok) {
    console.warn('[searchNotesMulti] embed failed:', embedResult.error);
    return [];
  }
  const queryVec = embedResult.vectors[0];
  if (!queryVec) return [];

  const allEmbeddings = await AIEmbeddingService.getAll();
  if (allEmbeddings.length === 0) return [];

  // Single vector search with combined embedding
  const vectorMatches = topKMultiWithChunkIndex(
    queryVec,
    allEmbeddings.map(e => ({
      id: e.documentId,
      vectors: e.vectors?.length ? e.vectors : (e.vector ? [e.vector] : []),
    })),
    VECTOR_TOP,
  );

  // TICKET-044: Run keyword searches for each query and merge (max score per doc)
  const keywordScores = new Map<string, number>();
  for (const q of queries) {
    const kwResults = await keywordSearch(q, KEYWORD_TOP);
    for (const { id, score } of kwResults) {
      const existing = keywordScores.get(id);
      if (existing === undefined || score > existing) {
        keywordScores.set(id, score);
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

  // TICKET-046: Bypass cloud rerank if top vector similarity is very high
  // or there's an exact title match
  const topScore = vectorMatches[0]?.score ?? 0;
  const hasExactTitle = await hasExactTitleMatch(queries[0]!, topIds);
  if (topScore >= RERANK_THRESHOLD || hasExactTitle) {
    const scoreMap = new Map(fused.map(f => [f.id, f.score]));
    const fallbackIds = topIds.slice(0, maxResults);
    const results = await loadNotes(fallbackIds, scoreMap, chunkIndexMap);
    putCache(queries[0]!, results);
    return results;
  }

  // Build rerank cards from LOCAL summaries
  const cardsDb = await getLocalDb();
  const cards: { documentId: string; card: string }[] = [];
  for (const id of topIds) {
    let card = '(саммари недоступно)';
    try {
      const summary = await cardsDb.get('aiSummaries', id);
      if (summary) {
        card = `Тональность: ${summary.tone}\nТемы: ${summary.themes.join(', ')}\nИнсайты: ${summary.insights.join('; ')}\nФакты: ${summary.extractedFacts.join('; ')}`;
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
  putCache(queries[0]!, results);
  return results;
}
