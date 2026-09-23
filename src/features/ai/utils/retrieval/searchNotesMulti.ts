import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import { topKMultiWithChunkIndex } from '../vectorSearch';
import { reportError } from '../../../../shared/errors/reportError';
import { reportAIDegradation } from '../aiDegradationReporter';
import { setAIStage } from '../../store/useAIStageStore';
import { getCurrentUser } from '../../../../core/auth';
import { hasIndexingConsent } from '../../../../core/ai/indexingConsent';
import { keywordSearch, corpusFingerprint } from './indexCache';
import {
  reciprocalRankFusion,
  shouldBoostKeywords,
  hasExactTitleMatch,
  getExactTitleMatchIds,
  loadNotes,
} from './fusion';
import { findLiteralMatches } from './literalMatches';
import { cleanCache, getCached, putCache } from './resultCache';
import { RRF_K, VECTOR_TOP, KEYWORD_TOP, RRF_FINAL, RERANK_THRESHOLD, RESURFACE_FLOOR } from './types';
import type { EmbeddingEntry, RetrievedNote } from './types';
import { searchNotes } from './searchNotes';
import { isExcludedFromAI } from '../isExcludedFromAI';

/**
 * TICKET-044: Consolidated multi-query search — single embedding + single rerank.
 * TICKET-045: Entity-aware keyword boosting in RRF fusion.
 * TICKET-046: Threshold-based cloud rerank bypassing.
 * TICKET-047: In-memory semantic query caching.
 */
export async function searchNotesMulti(
  queries: string[],
  maxResults = 5,
  opts?: { queryVector?: number[] | undefined; allEmbeddings?: EmbeddingEntry[] | undefined; minTime?: number | undefined; maxTime?: number | undefined },
): Promise<{ notes: RetrievedNote[]; failed: boolean; degraded?: boolean }> {
  if (queries.length === 0) return { notes: [], failed: false };

  try {
    // TICKET-047: Check cache before any network calls
    cleanCache();
    // Окно времени — часть запроса, а не его оформление. Без него «сравни весну и
    // осень» получает одни и те же заметки дважды, причём под разными заголовками.
    // 5 первых чисел вектора служат компактным различителем в случае разных векторов с одинаковым текстом.
    // AUDIT-L8: к ключу добавлен fingerprint КОРПУСА — устаревший кэш
    // перестаёт совпадать при изменении набора заметок.
    //
    // Вектор из ключа при этом не убираем. Он различает не корпус, а запрос:
    // один и тот же текст может прийти с разным queryVector (например,
    // объединённый запрос против обычного), и без этого различителя второй
    // получил бы чужой ответ из кэша. Два тега отвечают на разные вопросы —
    // «изменились ли заметки» и «тот ли это запрос», — и нужны оба.
    const vecTag = opts?.queryVector ? `\x01vec:${opts.queryVector.slice(0, 5).join(',')}` : '';
    const uid = getCurrentUser()?.uid ?? 'guest';
    const corpusTag = `\x01corpus:${corpusFingerprint(uid)}`;
    const cacheKey = [...queries].sort().join('\x00') + `\x01${opts?.minTime ?? ''}\x01${opts?.maxTime ?? ''}` + vecTag + corpusTag;
    const cached = getCached(cacheKey);
    if (cached) {
      const ids = cached.map(c => c.documentId);
      const scoreMap = new Map(cached.map(c => [c.documentId, c.score]));
      const chunkIndexMap = new Map(cached.map(c => [c.documentId, c.chunkIndex]));
      const cleanChunkIdx = new Map<string, number>();
      for (const [id, idx] of chunkIndexMap.entries()) {
        if (idx !== undefined) cleanChunkIdx.set(id, idx);
      }
      return { notes: await loadNotes(ids, scoreMap, cleanChunkIdx), failed: false };
    }

    if (queries.length === 1) {
      const results = await searchNotes(queries[0]!, maxResults, opts);
      putCache(cacheKey, results);
      return { notes: results, failed: false };
    }

    if (!hasIndexingConsent(uid)) {
      const combinedQuery = queries.join(' ');
      const results = await searchNotes(combinedQuery, maxResults, opts);
      putCache(cacheKey, results);
      return { notes: results, failed: false };
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
      reportAIDegradation({
        feature: 'search_notes_multi_embed',
        cause: embedResult.error,
        action: 'Построение вектора для мульти-поиска заметок',
        impact: 'Поиск по нескольким запросам не смог построить вектор',
      });
      return { notes: [], failed: true };
    }
    queryVec = embedResult.vectors[0];
  }
  if (!queryVec) return { notes: [], failed: true };

  const db = await getLocalDb();
  let filteredEmbeddings = opts?.allEmbeddings ?? await AIEmbeddingService.getAll();
  {
    const hasTimeFilter = opts?.minTime !== undefined || opts?.maxTime !== undefined;
    const allowed = new Set<string>();
    const docs = await db.getAll('documents');
    for (const doc of docs) {
      if (isExcludedFromAI(doc)) continue;
      const ts = doc.lastSessionAt;
      if (!hasTimeFilter) { allowed.add(doc.id); continue; }
      if (ts && (opts?.minTime === undefined || ts >= opts.minTime) && (opts?.maxTime === undefined || ts <= opts.maxTime)) {
        allowed.add(doc.id);
      }
    }
    filteredEmbeddings = filteredEmbeddings.filter(e => allowed.has(e.documentId));
  }

  const semanticUnavailable = filteredEmbeddings.length === 0;

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
    let kwResults = await keywordSearch(q, KEYWORD_TOP, uid);
    const decay = Math.pow(0.5, queryIdx);
    queryIdx++;
    if (opts?.minTime !== undefined || opts?.maxTime !== undefined) {
      const allowed = new Set<string>();
      const docs = await db.getAll('documents');
      for (const doc of docs) {
        if (isExcludedFromAI(doc)) continue;
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
  // Same local check as the single-query path, stem-aware so «про Сашу» matches
  // a note that says «Саша».
  const matchedIds = await findLiteralMatches(queries[0]!, topIds);

  const exactTitleIds = await getExactTitleMatchIds(queries[0]!, topIds);
  const vectorScoreMap = new Map(vectorMatches.map(m => [m.id, m.score]));

  const filterByRelevanceFloor = (idList: string[]): string[] => {
    // The floor is a vector-similarity floor. With no embeddings every score is
    // 0, so applying it would throw away the keyword matches that are the only
    // results left — the floor is meaningless when there is nothing to score.
    if (semanticUnavailable) return idList;
    // Same as the single-query path: a keyword hit is evidence in itself and
    // must not be judged by a vector score it never had.
    const keywordIds = new Set(mergedKeyword.map(m => m.id));
    return idList.filter(id => {
      if (exactTitleIds.has(id) || matchedIds.has(id) || keywordIds.has(id)) return true;
      const score = vectorScoreMap.get(id) ?? 0;
      return score >= RESURFACE_FLOOR;
    });
  };

  const filteredTopIds = filterByRelevanceFloor(topIds);

  // Bypass the cloud rerank when a strong local signal exists, and lift local
  // matches to the front (stable — the fused order is preserved otherwise).
  if (topScore >= RERANK_THRESHOLD || hasExactTitle || matchedIds.size > 0) {
    const scoreMap = new Map(fused.map(f => [f.id, f.score]));
    const ordered = [...filteredTopIds].sort(
      (a, b) => (matchedIds.has(b) ? 1 : 0) - (matchedIds.has(a) ? 1 : 0),
    );
    const fallbackIds = ordered.slice(0, maxResults);
    const results = await loadNotes(fallbackIds, scoreMap, chunkIndexMap);
    putCache(cacheKey, results);
    return { notes: results, failed: false, degraded: semanticUnavailable };
  }

  if (filteredTopIds.length === 0) {
    putCache(cacheKey, []);
    return { notes: [], failed: false, degraded: semanticUnavailable };
  }

  // Build rerank cards from LOCAL summaries
  const cardsDb = await getLocalDb();
  const cards: { documentId: string; card: string }[] = [];
  for (const id of filteredTopIds) {
    let card = '(саммари недоступно)';
    try {
      const doc = await cardsDb.get('documents', id);
      const title = doc?.title || 'Без названия';
      const summary = await cardsDb.get('aiSummaries', id);
      if (summary?.summary && summary.summary.trim().length >= 80) {
        card = `${title}\n${summary.summary.trim()}`;
      } else {
        let excerpt = '';
        const chunkIdx = chunkIndexMap.get(id);
        if (chunkIdx !== undefined && chunkIdx >= 0) {
          try {
            const emb = await AIEmbeddingService.get(id);
            const matchedText = emb?.chunkTexts?.[chunkIdx];
            if (matchedText) {
              excerpt = matchedText.slice(0, 400);
            }
          } catch { /* ignore */ }
        }
        if (!excerpt) {
          try {
            const content = await LocalVersionService.getLatestContent(id);
            if (content) {
              excerpt = content.slice(0, 400);
            }
          } catch { /* ignore */ }
        }
        card = `${title}\n${excerpt}`;
      }
    } catch { /* keep placeholder */ }
    cards.push({ documentId: id, card });
  }

  // TICKET-044: Single rerank call using original query
  const fallbackIds = filteredTopIds.slice(0, maxResults);
  setAIStage('rank');
  const rr = await AIService.rerank({
    query: queries[0]!,
    candidates: cards,
    maxResults,
  });

  const rerankOk = rr.ok && rr.documentIds.length > 0;
  if (!rerankOk) {
    reportAIDegradation({
      feature: 'search_rerank',
      cause: rr.ok ? 'RERANK_EMPTY' : rr.error,
      action: 'Реранжирование результатов поиска',
      impact: 'Использован базовый порядок RRF',
    });
  }

  const ids = rerankOk ? rr.documentIds.slice(0, maxResults) : fallbackIds;
  const finalIds = ids.filter(id => filteredTopIds.includes(id));

  const scoreMap = new Map(fused.map(f => [f.id, f.score]));
  const results = await loadNotes(finalIds, scoreMap, chunkIndexMap);

    // TICKET-047: Cache results
    putCache(cacheKey, results);
    return { notes: results, failed: false, degraded: semanticUnavailable };
  } catch (e) {
    reportError(e, { action: 'noteRetriever/searchNotesMulti' });
    return { notes: [], failed: true };
  }
}
