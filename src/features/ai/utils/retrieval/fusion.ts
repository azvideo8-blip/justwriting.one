import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { loadDocumentSnapshot, loadAnalysedIds } from './docSnapshot';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';
import type { RetrievedNote } from './types';
import { isExcludedFromAI } from '../isExcludedFromAI';

/** Reciprocal Rank Fusion: combine two ranked lists into one.
 *  TICKET-045: supports keywordWeight to boost exact-term matches. */
export function reciprocalRankFusion(
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
export function shouldBoostKeywords(query: string): boolean {
  const hasNames = /[А-ЯЁ][а-яё]{2,}/.test(query);
  const hasQuotes = /["'«»]/.test(query);
  return hasNames || hasQuotes;
}

// TICKET-046: Check for exact title match to bypass rerank
export function hasExactTitleMatch(query: string, topIds: string[]): Promise<boolean> {
  return (async () => {
    const docs = await loadDocumentSnapshot(); // X-5
    const qLower = query.trim().toLowerCase();
    for (const id of topIds.slice(0, 5)) {
      const doc = docs.get(id);
      if (doc?.title?.trim().toLowerCase() === qLower) return true;
    }
    return false;
  })();
}

export async function getExactTitleMatchIds(query: string, ids: string[]): Promise<Set<string>> {
  const docs = await loadDocumentSnapshot(); // X-5
  const qLower = query.trim().toLowerCase();
  const exactIds = new Set<string>();
  for (const id of ids) {
    const doc = docs.get(id);
    if (doc?.title?.trim().toLowerCase() === qLower) {
      exactIds.add(id);
    }
  }
  return exactIds;
}

/** RRF живёт в шкале ≤~0.05 (#104): нормализуем к [0..1], чтобы вес в
 *  композиции означал то, что заявлен. Публичный ради TEST-1 §2.5. */
export function vectorScore01(raw: number): number {
  return Math.min(1, Math.max(0, raw) * 20);
}

/** Loads title + chunk context for the given document ids, preserving order.
 *  TICKET-023: For notes with chunk embeddings, loads only the matching chunk
 *  + its neighbours instead of the full note content. */
export async function loadNotes(
  ids: string[],
  scoreMap: Map<string, number>,
  chunkIndexMap?: Map<string, number>,
): Promise<RetrievedNote[]> {
  const results: RetrievedNote[] = [];
  // X-5: один снимок заметок вместо точечного чтения на каждого кандидата.
  const docs = await loadDocumentSnapshot();
  // TR-9: последний рубеж выдачи поиска — текст неразобранной заметки не грузится.
  const analysed = await loadAnalysedIds();
  for (const docId of ids) {
    const doc = docs.get(docId);
    if (!doc || isExcludedFromAI(doc) || !analysed.has(doc.id)) continue;
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
