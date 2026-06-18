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

/** Reciprocal Rank Fusion: combine two ranked lists into one. */
function reciprocalRankFusion(
  vectorRanked: { id: string; score: number }[],
  keywordRanked: { id: string; score: number }[],
  k: number,
): { id: string; score: number }[] {
  const scores = new Map<string, number>();

  for (let rank = 0; rank < vectorRanked.length; rank++) {
    const id = vectorRanked[rank]!.id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
  }

  for (let rank = 0; rank < keywordRanked.length; rank++) {
    const id = keywordRanked[rank]!.id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
  }

  const result = [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);

  return result;
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

  // RRF fusion (strip chunkIndex for RRF, keep map for later)
  const chunkIndexMap = new Map(vectorMatches.map(m => [m.id, m.chunkIndex]));
  const fused = reciprocalRankFusion(
    vectorMatches.map(({ id, score }) => ({ id, score })),
    keywordMatches,
    RRF_K,
  );
  const topIds = fused.slice(0, RRF_FINAL).map(f => f.id);

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

/**
 * TICKET-024: Multi-query search — run searchNotes for the original query plus
 * each expanded query, then fuse all results via RRF.
 */
export async function searchNotesMulti(
  queries: string[],
  maxResults = 5,
): Promise<RetrievedNote[]> {
  if (queries.length <= 1) return searchNotes(queries[0] ?? '', maxResults);

  const allResults = await Promise.all(queries.map(q => searchNotes(q, maxResults * 2)));

  // RRF fusion across all result lists
  const rrfK = 60;
  const scores = new Map<string, number>();
  const noteMap = new Map<string, RetrievedNote>();

  for (const results of allResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const note = results[rank]!;
      const id = note.documentId;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (rrfK + rank));
      if (!noteMap.has(id)) noteMap.set(id, note);
    }
  }

  const fused = [...scores.entries()]
    .map(([id, score]) => ({ id, score, note: noteMap.get(id)! }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return fused.map(f => ({ ...f.note, score: f.score }));
}
