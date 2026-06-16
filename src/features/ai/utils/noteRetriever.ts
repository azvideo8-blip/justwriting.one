import { AIEmbeddingService } from '../services/AIEmbeddingService';
import { AIService } from '../services/AIService';
import { AISummaryService } from '../services/AISummaryService';
import { getLocalDb } from '../../../core/storage/localDb';
import { topK } from '../utils/vectorSearch';

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

  const allEmbeddings = await AIEmbeddingService.getAll();
  if (allEmbeddings.length === 0) return [];

  const matches = topK(
    embedResult.vector,
    allEmbeddings.map(e => ({ id: e.documentId, vector: e.vector })),
    40,
  );

  const cards: { documentId: string; score: number; card: string }[] = [];
  for (const m of matches) {
    const summary = await AISummaryService.get(m.id);
    if (summary) {
      cards.push({
        documentId: m.id,
        score: m.score,
        card: `Тональность: ${summary.tone}\nТемы: ${summary.themes.join(', ')}\nИнсайты: ${summary.insights.join('; ')}\nФакты: ${summary.extractedFacts.join('; ')}`,
      });
    } else {
      cards.push({
        documentId: m.id,
        score: m.score,
        card: '(саммари недоступно)',
      });
    }
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
