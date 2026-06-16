import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIService } from '../services/AIService';
import { getLocalDb } from '../../../core/storage/localDb';
import { topKMulti } from '../utils/vectorSearch';

export interface RetrievedNote {
  documentId: string;
  title: string;
  content: string;
  score: number;
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

  const matches = topKMulti(
    queryVec,
    // Each note has per-chunk vectors; fall back to the legacy single vector.
    allEmbeddings.map(e => ({
      id: e.documentId,
      vectors: e.vectors?.length ? e.vectors : (e.vector ? [e.vector] : []),
    })),
    40,
  );

  // Build rerank cards from LOCAL summaries only. Never cloud-fetch here: a cloud
  // read can throw (LOCKED decrypt when E2E is locked, permissions) and would
  // break the whole search → the chat would silently fall back to a no-context
  // answer ("I have no access to your notes"). A missing summary is just a
  // placeholder; the reranker still has the note id + vector score.
  const cardsDb = await getLocalDb();
  const cards: { documentId: string; score: number; card: string }[] = [];
  for (const m of matches) {
    let card = '(саммари недоступно)';
    try {
      const summary = await cardsDb.get('aiSummaries', m.id);
      if (summary) {
        card = `Тональность: ${summary.tone}\nТемы: ${summary.themes.join(', ')}\nИнсайты: ${summary.insights.join('; ')}\nФакты: ${summary.extractedFacts.join('; ')}`;
      }
    } catch { /* keep placeholder */ }
    cards.push({ documentId: m.id, score: m.score, card });
  }

  // Rerank via the dedicated rerankNotes endpoint — NOT the chat function, which
  // is rate/daily-limited (every search would burn the user's chat quota and 429).
  // On any failure, fall back to raw vector (cosine) order.
  const fallbackIds = matches.slice(0, maxResults).map(m => m.id);
  const rr = await AIService.rerank({
    query,
    candidates: cards.map(c => ({ documentId: c.documentId, card: c.card })),
    maxResults,
  });

  const ids = rr.ok && rr.documentIds.length > 0 ? rr.documentIds.slice(0, maxResults) : fallbackIds;
  return loadNotes(ids, matches);
}

/** Loads title + latest content for the given document ids, preserving order. */
async function loadNotes(
  ids: string[],
  matches: { id: string; score: number }[],
): Promise<RetrievedNote[]> {
  const results: RetrievedNote[] = [];
  const db = await getLocalDb();
  for (const docId of ids) {
    const doc = await db.get('documents', docId);
    if (!doc) continue;
    const versions = await db.getAllFromIndex('versions', 'by-document', docId);
    if (versions.length === 0) continue;
    versions.sort((a, b) => b.version - a.version);
    const content = versions[0]?.content ?? '';
    const match = matches.find(m => m.id === docId);
    results.push({
      documentId: docId,
      title: doc.title || 'Без названия',
      content,
      score: match?.score ?? 0,
    });
  }
  return results;
}
