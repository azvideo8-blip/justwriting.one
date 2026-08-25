import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { AIService } from '../../services/AIService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { topKMultiWithChunkIndex } from '../vectorSearch';
import { reportError } from '../../../../shared/errors/reportError';
import { reportAIDegradation } from '../aiDegradationReporter';
import { setAIStage } from '../../store/useAIStageStore';
import { getCurrentUser } from '../../../../core/auth';
import { hasIndexingConsent } from '../../../../core/ai/indexingConsent';
import { keywordSearch, timed } from './indexCache';
import {
  reciprocalRankFusion,
  shouldBoostKeywords,
  hasExactTitleMatch,
  getExactTitleMatchIds,
  loadNotes,
} from './fusion';
import { findLiteralMatches, extractQuotes } from './literalMatches';
import { RRF_K, VECTOR_TOP, KEYWORD_TOP, RRF_FINAL, RERANK_THRESHOLD, RESURFACE_FLOOR } from './types';
import type { RetrievedNote, SearchNotesOptions } from './types';

export async function searchNotes(
  query: string,
  maxResults = 5,
  opts?: SearchNotesOptions,
): Promise<RetrievedNote[]> {
  const uid = getCurrentUser()?.uid;
  if (!opts?.queryVector && !hasIndexingConsent(uid)) {
    let keywordMatches = await keywordSearch(query, maxResults);
    const db = await getLocalDb();
    if (opts?.minTime !== undefined || opts?.maxTime !== undefined) {
      const allowed = new Set<string>();
      const docs = await db.getAll('documents');
      for (const doc of docs) {
        if (doc.excludedFromAI) continue;
        const ts = doc.lastSessionAt;
        if (ts && (opts.minTime === undefined || ts >= opts.minTime) && (opts.maxTime === undefined || ts <= opts.maxTime)) {
          allowed.add(doc.id);
        }
      }
      keywordMatches = keywordMatches.filter(m => allowed.has(m.id));
    }
    // AG-VERIFY-2 (находка 2): обе ветки кладут в scoreMap одну шкалу — RRF
    // (~0.02–0.05), иначе vectorScore01(raw)=min(1,raw*20) насыщается на
    // уже-нормализованных 0..1 и композит для отказавшихся от индексации
    // вырождается: все заметки получают одинаковый семантический член.
    const scoreMap = new Map(keywordMatches.map((m, i) => [m.id, 1 / (RRF_K + i)]));
    opts?.onRerankMeta?.({ bypassed: true, bypassReason: 'indexing_consent_refused' });
    return loadNotes(keywordMatches.map(m => m.id), scoreMap);
  }

  let queryVec = opts?.queryVector;
  if (!queryVec) {
    // AUD-22: embedding-вызов — самая дорогая часть хода, размечен отдельно.
    const embedResult = await timed('query_embed', () => AIService.embed({ content: query }));
    if (!embedResult.ok) {
      reportError(embedResult.error, { action: 'search_notes_embed' });
      reportAIDegradation({
        feature: 'search_notes_embed',
        cause: embedResult.error,
        action: 'Построение вектора для поиска заметок',
        impact: 'Семантический поиск пропущен',
      });
      return [];
    }
    queryVec = embedResult.vectors[0];
  }
  if (!queryVec) return [];

  let filteredEmbeddings = opts?.allEmbeddings ?? await AIEmbeddingService.getAll();
  const db = await getLocalDb();
  {
    // Always restrict to embeddings that still belong to a local note. Analysis
    // restored from the cloud can outnumber the notes (older records from
    // earlier local-id generations), and an orphan competing in the ranking
    // takes a slot from a real note and resolves to nothing.
    const hasTimeFilter = opts?.minTime !== undefined || opts?.maxTime !== undefined;
    const allowed = new Set<string>();
    const docs = await db.getAll('documents');
    for (const doc of docs) {
      if (doc.excludedFromAI) continue;
      const ts = doc.lastSessionAt;
      if (!hasTimeFilter) { allowed.add(doc.id); continue; }
      if (ts && (opts?.minTime === undefined || ts >= opts.minTime) && (opts?.maxTime === undefined || ts <= opts.maxTime)) {
        allowed.add(doc.id);
      }
    }
    filteredEmbeddings = filteredEmbeddings.filter(e => allowed.has(e.documentId));
  }

  // No early return on an empty embedding store. The keyword search below reads
  // the notes' own text and needs no vectors at all — bailing here made the
  // entire archive invisible to search whenever the embeddings were missing,
  // and reported it as "nothing matched" rather than "the index is not built".
  const vectorMatches = await timed('vector_scan', async () => topKMultiWithChunkIndex(
    queryVec,
    filteredEmbeddings.map(e => ({
      id: e.documentId,
      vectors: e.vectors?.length ? e.vectors : (e.vector ? [e.vector] : []),
    })),
    VECTOR_TOP,
  ));

  let keywordMatches = await keywordSearch(query, KEYWORD_TOP);
  if (opts?.minTime !== undefined || opts?.maxTime !== undefined) {
    const allowed = new Set<string>();
    const docs = await db.getAll('documents');
    for (const doc of docs) {
      if (doc.excludedFromAI) continue;
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

  const exactTitleIds = await getExactTitleMatchIds(query, topIds);
  const vectorScoreMap = new Map(vectorMatches.map(m => [m.id, m.score]));

  // A keyword hit carries its own evidence: the word is in the note. The floor
  // is a VECTOR-similarity floor, and a note the vector search never returned
  // has no score at all — scoring it 0 and dropping it deleted every
  // keyword-only match, which is exactly what a search for a person's name is.
  // It made the BM25 half of the hybrid search decorative: it could only
  // re-order what the vectors had already found.
  const keywordIds = new Set(keywordMatches.map(m => m.id));

  const filterByRelevanceFloor = (idList: string[]): string[] => {
    return idList.filter(id => {
      if (exactTitleIds.has(id) || keywordIds.has(id)) return true;
      const score = vectorScoreMap.get(id) ?? 0;
      return score >= RESURFACE_FLOOR;
    });
  };

  const filteredTopIds = filterByRelevanceFloor(topIds);

  // A candidate whose text literally contains the name or the quoted phrase is
  // stronger evidence than anything a reranker can add, and the rerank is a
  // network round-trip to the model. Checking locally first is both faster and
  // better ordered — this is what made a search for a person take seconds.
  const literalIds = await findLiteralMatches(query, filteredTopIds);

  // Bypass-гейт: одно «литеральное попадание» — слишком дёшево, чтобы платить
  // за него пропуском реранка (стеммер до фикса делал hits непустым почти на
  // любом запросе). Достаточно двух попаданий ИЛИ одной дословной цитаты.
  const literalBypass = literalIds.size >= 2 || (literalIds.size >= 1 && extractQuotes(query).length > 0);

  const scoreMap = new Map(fused.map(f => [f.id, f.score]));

  if (topScore >= RERANK_THRESHOLD || hasExactTitle || literalBypass) {
    const reason = topScore >= RERANK_THRESHOLD ? 'score_threshold' : (hasExactTitle ? 'exact_title' : 'literal_match');
    opts?.onRerankMeta?.({ bypassed: true, bypassReason: reason });
    // Once some candidates contain the term verbatim, a candidate that does not
    // and has no real semantic score is noise: it reached the list on a weak
    // fusion rank. Handing it over anyway made the assistant list notes and then
    // admit "в этом фрагменте упоминаний нет" — worse than not showing them.
    const relevant = literalIds.size > 0
      ? filteredTopIds.filter(id => literalIds.has(id) || (vectorScoreMap.get(id) ?? 0) >= RESURFACE_FLOOR)
      : filteredTopIds;
    const ordered = [...relevant].sort(
      (a, b) => (literalIds.has(b) ? 1 : 0) - (literalIds.has(a) ? 1 : 0),
    );
    return loadNotes(ordered.slice(0, maxResults), scoreMap, chunkIndexMap);
  }

  if (filteredTopIds.length === 0) {
    opts?.onRerankMeta?.({ bypassed: true, bypassReason: 'empty_candidates' });
    return [];
  }

  if (opts?.skipRerank) {
    opts?.onRerankMeta?.({ bypassed: true, bypassReason: 'skip_option' });
    return loadNotes(filteredTopIds.slice(0, maxResults), scoreMap, chunkIndexMap);
  }

  // Build rerank cards from LOCAL summaries
  const cardsDb = await getLocalDb();
  const cards: { documentId: string; card: string }[] = [];
  for (const id of filteredTopIds) {
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
  const fallbackIds = filteredTopIds.slice(0, maxResults);
  setAIStage('rank');
  const rerankStart = performance.now();
  const rr = await AIService.rerank({
    query,
    candidates: cards,
    maxResults,
  });
  const rerankLatencyMs = Math.round(performance.now() - rerankStart);
  // Неудачный реранк подменяется порядком RRF — и это правильно для человека,
  // ищущего заметку, но снаружи неотличимо от удачного. При исчерпанной дневной
  // квоте поиск молча перестаёт переупорядочивать, а замер 21 августа записал
  // такие запросы как «реранк отработал, разницы нет».
  const rerankOk = rr.ok && rr.documentIds.length > 0;
  if (!rerankOk) {
    reportAIDegradation({
      feature: 'search_rerank',
      cause: rr.ok ? 'RERANK_EMPTY' : rr.error,
      action: 'Реранжирование результатов поиска',
      impact: 'Использован базовый порядок RRF',
    });
  }
  opts?.onRerankMeta?.({
    bypassed: false,
    rerankLatencyMs,
    cardCount: cards.length,
    rerankFailed: !rerankOk,
  });

  const ids = rerankOk ? rr.documentIds.slice(0, maxResults) : fallbackIds;
  const finalIds = ids.filter(id => filteredTopIds.includes(id));

  return loadNotes(finalIds, scoreMap, chunkIndexMap);
}
