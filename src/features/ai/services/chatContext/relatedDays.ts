import type { AIDocumentEmbedding, AIDocumentSummary, LocalDocument } from '../../../../core/storage/localDb';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';
import { cosineSimilarity } from '../../utils/vectorSearch';
import { formatDateYYYYMMDD } from './corpusStats';
import { localDay, referencedDays } from './explicitRefs';

// Разбор приложенной заметки видел только её саму, и главное, чем выигрывал
// разговор с Claude, — связи с прошлыми днями (разбор живых диалогов 09.10).
// Фон — суть 3–4 похожих записей с датой и id, отдельным блоком ПЕРЕД заметкой:
// заметка остаётся последним блоком данных (A-3). Только локальные векторы и
// готовые разборы — ни одного нового вызова ИИ на горячем пути (план MIND).

const MAX_DAYS = 4;
// FN-3, замер владельца 2026-10-22 (99 кандидатов, bge-m3): при 0,55 проходили
// 99,4 % пар — порог ничего не отсекал (медиана косинуса 0,795); при 0,85 проходят
// 13 % пар, медиана 8 соседей на заметку. Явные ссылки FN-1 идут мимо порога.
const MIN_SIMILARITY = 0.85;
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

// Н-3 (дейлик 2026-10-23): у хода бывает несколько приложенных заметок, каждая
// со своей шапкой `[#id · yyyy-mm-dd]` (день заметки по местному времени). «Вчера»
// второй заметки — канун ЕЁ дня, а не первой. Текст до первой шапки — от `noteAt`.
const BLOCK_SEP = '\n\n---\n\n';
const BLOCK_HEAD = /^\[#[^\s\]·]+ · (\d{4})-(\d{2})-(\d{2})\]$/gm;
function daysNamedInBlocks(text: string, noteAt: number | undefined): Set<number> {
  // Ссылка `[#id · дата]` внутри тела блока не начинает (как в hideExcludedNotes).
  const heads = [...text.matchAll(BLOCK_HEAD)].filter(h => h.index === 0 || text.slice(0, h.index).endsWith(BLOCK_SEP));
  const out = referencedDays(text.slice(0, heads[0]?.index ?? text.length), noteAt);
  heads.forEach((h, i) => {
    const blockAt = new Date(+h[1]!, +h[2]! - 1, +h[3]!, 12).getTime();
    for (const d of referencedDays(text.slice(h.index, heads[i + 1]?.index ?? text.length), blockAt)) out.add(d);
  });
  return out;
}

export function relativeDayLabel(noteAt: number | undefined, at: number): string {
  if (!noteAt) return '';
  const diff = Math.round((localDay(at) - localDay(noteAt)) / 86_400_000);
  if (diff === 0) return ' · в тот же день';
  return diff < 0 ? ` · за ${-diff} дн. до этой заметки` : ` · через ${diff} дн. после этой заметки`;
}

// FN-1: записи дней, названных в тексте приложенной (`attachedText`), в фоне
// гарантированно, остаток до MAX_DAYS добирает сходство; строки — по дате (A6b:
// «явные первыми» модель читала как «самая ранняя»). FN-2: `otherAttachedIds` —
// остальные приложенные к ходу заметки; они в ходе целиком и «другим днём» не
// называются.
export function buildRelatedDaysBlock(
  attachedId: string,
  embeddings: AIDocumentEmbedding[],
  docs: Map<string, LocalDocument>,
  summaries: Map<string, AIDocumentSummary>,
  attachedText = '',
  otherAttachedIds: string[] = [],
): RelatedDays | null {
  const skip = new Set([attachedId, ...otherAttachedIds]);
  const noteAt = docs.get(attachedId)?.lastSessionAt;
  const usable = (id: string): { id: string; at: number; summary: string } | null => {
    if (skip.has(id)) return null;
    const doc = docs.get(id);
    // Скрытая от ИИ, в корзине или пропавшая заметка не называется даже сутью.
    if (!doc || isExcludedFromAI(doc)) return null;
    const summary = summaries.get(id)?.summary?.trim();
    // Только готовый разбор: сырой текст другой заметки модель читала бы как
    // материал для цитат.
    return summary ? { id, at: doc.lastSessionAt ?? 0, summary } : null;
  };

  const days = daysNamedInBlocks(attachedText, noteAt);
  const onDay = (t: number | undefined) => !!t && days.has(localDay(t));
  // R-13: в строке — тот день, по которому запись найдена (первая сессия, если
  // названа она), а не последняя сессия: иначе «10.10» в тексте и «2026-10-20» у модели.
  const explicit = days.size
    ? [...docs.values()]
      .filter(d => onDay(d.lastSessionAt) || onDay(d.firstSessionAt))
      .map(d => {
        const u = usable(d.id);
        return u && !onDay(d.lastSessionAt) ? { ...u, at: d.firstSessionAt! } : u;
      })
      .filter(x => x !== null)
      .sort((a, b) => a.at - b.at)
      .slice(0, MAX_DAYS)
    : [];
  const explicitIds = new Set(explicit.map(e => e.id));

  const self = embeddings.find(e => e.documentId === attachedId);
  const selfVec = self?.vectors?.length ? centroid(self.vectors) : null;
  const scored: Array<{ id: string; at: number; summary: string; sim: number }> = [];
  for (const e of embeddings) {
    if (!selfVec) break;
    if (explicitIds.has(e.documentId) || !e.vectors?.length) continue;
    const u = usable(e.documentId);
    if (!u) continue;
    const vec = centroid(e.vectors);
    if (!vec || vec.length !== selfVec.length) continue;
    const sim = cosineSimilarity(selfVec, vec);
    if (sim >= MIN_SIMILARITY) scored.push({ ...u, sim });
  }
  if (explicit.length === 0 && scored.length === 0) return null;

  const similar = scored.sort((a, b) => b.sim - a.sim).slice(0, MAX_DAYS - explicit.length);
  const picked = [...explicit, ...similar].sort((a, b) => a.at - b.at);
  const lines = picked.map(p => {
    const s = p.summary.length > SUMMARY_CHARS ? `${p.summary.slice(0, SUMMARY_CHARS)}…` : p.summary;
    return `[#${p.id} · ${formatDateYYYYMMDD(p.at)}${relativeDayLabel(noteAt, p.at)}] ${s}`;
  });
  return {
    block: '[Другие дни — фон, НЕ эта заметка: суть похожих записей. Связь с ними называй как связь с другим днём, со ссылкой [#id]; их содержание этой заметке не приписывай и не цитируй]\n' + lines.join('\n'),
    ids: picked.map(p => p.id),
  };
}
