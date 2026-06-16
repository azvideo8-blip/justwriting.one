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
    15,
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

  const cardsText = cards.map((c, i) => `[${i + 1}] docId=${c.documentId} score=${c.score.toFixed(3)}\n${c.card}`).join('\n\n');

  // Rerank via the chat function. There is no dedicated persona for this, so we
  // pass personaId 'custom' (the only one accepting a customSystemPrompt) — the
  // backend z.enum rejects any other id. On failure we fall back to raw vector order.
  const llmResult = await AIService.chat({
    personaId: 'custom',
    customSystemPrompt: 'Ты — модуль ранжирования заметок. По запросу пользователя и списку заметок-кандидатов выбери самые релевантные. Верни ТОЛЬКО JSON-массив documentId, без пояснений и markdown. Пример: ["id1","id2"].',
    messages: [
      { role: 'user', content: `Запрос пользователя: "${query}"\n\nКандидаты-заметки:\n${cardsText}\n\nВыбери до ${maxResults} самых релевантных заметок для этого запроса. Верни ТОЛЬКО массив documentId в JSON, без пояснений. Пример: ["id1","id2"]` },
    ],
  });

  const fallbackIds = matches.slice(0, maxResults).map(m => m.id);
  if (!llmResult.ok) {
    return loadNotes(fallbackIds, matches);
  }

  let selectedIds: string[];
  try {
    let text = llmResult.text.trim();
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    }
    selectedIds = JSON.parse(text);
    if (!Array.isArray(selectedIds)) selectedIds = [];
  } catch {
    return loadNotes(fallbackIds, matches);
  }

  const ids = selectedIds.slice(0, maxResults);
  return loadNotes(ids.length > 0 ? ids : fallbackIds, matches);
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
