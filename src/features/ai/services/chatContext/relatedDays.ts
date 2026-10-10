import type { AIDocumentEmbedding, AIDocumentSummary, LocalDocument } from '../../../../core/storage/localDb';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';
import { cosineSimilarity } from '../../utils/vectorSearch';
import { formatDateYYYYMMDD } from './corpusStats';

// Разбор приложенной заметки видел только её саму, и главное, чем выигрывал
// разговор с Claude, — связи с прошлыми днями (разбор живых диалогов 09.10).
// Фон — суть 3–4 похожих записей с датой и id, отдельным блоком ПЕРЕД заметкой:
// заметка остаётся последним блоком данных (A-3). Только локальные векторы и
// готовые разборы — ни одного нового вызова ИИ на горячем пути (план MIND).

const MAX_DAYS = 4;
// bge-m3: соседние по теме дневниковые записи ~0,55–0,75, случайные ~0,3–0,45.
const MIN_SIMILARITY = 0.55;
const SUMMARY_CHARS = 300;

function centroid(vectors: number[][]): number[] | null {
  const dim = vectors[0]?.length ?? 0;
  if (!dim) return null;
  const sum = new Array<number>(dim).fill(0);
  let n = 0;
  for (const v of vectors) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) sum[i]! += v[i]!;
    n++;
  }
  return n ? sum.map(x => x / n) : null;
}

export interface RelatedDays { block: string; ids: string[] }

export function buildRelatedDaysBlock(
  attachedId: string,
  embeddings: AIDocumentEmbedding[],
  docs: Map<string, LocalDocument>,
  summaries: Map<string, AIDocumentSummary>,
): RelatedDays | null {
  const self = embeddings.find(e => e.documentId === attachedId);
  const selfVec = self?.vectors?.length ? centroid(self.vectors) : null;
  if (!selfVec) return null;

  const scored: Array<{ id: string; at: number; summary: string; sim: number }> = [];
  for (const e of embeddings) {
    if (e.documentId === attachedId || !e.vectors?.length) continue;
    const doc = docs.get(e.documentId);
    // Скрытая от ИИ, в корзине или пропавшая заметка не называется даже сутью.
    if (!doc || isExcludedFromAI(doc)) continue;
    const summary = summaries.get(e.documentId)?.summary?.trim();
    // Только готовый разбор: сырой текст другой заметки модель читала бы как
    // материал для цитат.
    if (!summary) continue;
    const vec = centroid(e.vectors);
    if (!vec || vec.length !== selfVec.length) continue;
    const sim = cosineSimilarity(selfVec, vec);
    if (sim >= MIN_SIMILARITY) scored.push({ id: e.documentId, at: doc.lastSessionAt ?? 0, summary, sim });
  }
  if (scored.length === 0) return null;

  const picked = scored.sort((a, b) => b.sim - a.sim).slice(0, MAX_DAYS).sort((a, b) => a.at - b.at);
  const lines = picked.map(p => {
    const s = p.summary.length > SUMMARY_CHARS ? `${p.summary.slice(0, SUMMARY_CHARS)}…` : p.summary;
    return `[#${p.id} · ${formatDateYYYYMMDD(p.at)}] ${s}`;
  });
  return {
    block: '[Другие дни — фон, НЕ эта заметка: суть похожих записей. Связь с ними называй как связь с другим днём, со ссылкой [#id]; их содержание этой заметке не приписывай и не цитируй]\n' + lines.join('\n'),
    ids: picked.map(p => p.id),
  };
}
