import { getLocalDb } from '../../../../core/storage/localDb';
import { AIEmbeddingService } from '../AIEmbeddingService';
import { topKMultiWithChunkIndex } from '../../utils/vectorSearch';
import { LITE_FLOOR } from '../../utils/retrieval/types';
import { reportError } from '../../../../shared/errors/reportError';
import { formatDateYYYYMMDD } from './corpusStats';
import { loadAnalysedIds } from '../../utils/retrieval/docSnapshot';
import { isExcludedFromAI } from '../../utils/isExcludedFromAI';

interface LiteRetrievalDeps {
  turnEmb: number[] | undefined;
  db: Awaited<ReturnType<typeof getLocalDb>>;
  minTime: number | undefined;
  maxTime: number | undefined;
  /** Куда дописать id выданных заметок (allowlist цитат, AUDIT-M3). */
  injectedDocumentIds: string[];
}

/** Lite retrieval, если полный поиск не выполнялся. Возвращает блок или null. */
export async function buildLiteRetrievalBlock(deps: LiteRetrievalDeps): Promise<string | null> {
  const { turnEmb, db, minTime, maxTime, injectedDocumentIds } = deps;
  if (!turnEmb) return null;
  try {
    const allEmb = await AIEmbeddingService.getAll();
    const docs = await db.getAll('documents');
    const analysed = await loadAnalysedIds(); // TR-9
    const usable = new Set(docs.filter(d => {
      if (isExcludedFromAI(d) || !analysed.has(d.id)) return false;
      const ts = d.lastSessionAt || d.firstSessionAt;
      if (minTime !== undefined && (!ts || ts < minTime)) return false;
      if (maxTime !== undefined && (!ts || ts > maxTime)) return false;
      return true;
    }).map(d => d.id));
    const filteredEmb = allEmb.filter(e => usable.has(e.documentId));
    const results = topKMultiWithChunkIndex(turnEmb, filteredEmb.map(e => ({ id: e.documentId, vectors: e.vectors })), 3)
      // П-4: лёгкий поиск без порога превращался в шум на запросах, где ответа
      // в архиве нет. Сравниваем с исходным косинусом, не с ранговым значением.
      .filter(r => ((r as { rawScore?: number }).rawScore ?? r.score) >= LITE_FLOOR);
    if (results.length === 0) return null;
    const parts = [];
    let idx = 0;
    for (const r of results) {
      const doc = await db.get('documents', r.id);
      if (!doc) continue;
      const emb = allEmb.find(e => e.documentId === r.id);
      const textChunk = emb?.chunkTexts?.[r.chunkIndex] || '';
      if (!textChunk.trim()) continue;
      idx++;
      const yyyymmdd = formatDateYYYYMMDD(doc.lastSessionAt);
      injectedDocumentIds.push(r.id);
      parts.push(`[#${doc.id} · ${yyyymmdd}]\nЗаметка ${idx}: "${doc.title || 'Без названия'}"\n${textChunk}`);
    }
    if (parts.length === 0) return null;
    return `[Возможно релевантные заметки]\n` + parts.join('\n\n');
  } catch (e) {
    reportError(e, { action: '[useAIChatContext] lite retrieval failed' });
    return null;
  }
}
