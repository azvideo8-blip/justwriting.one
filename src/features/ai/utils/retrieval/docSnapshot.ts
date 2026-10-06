import { getLocalDb } from '../../../../core/storage/localDb';
import type { LocalDocument, AIDocumentSummary } from '../../../../core/storage/localDb';

/**
 * X-5: снимки хранилищ на один вызов поиска.
 *
 * Ход по вопросу о заметке читал `documents.get` и `aiSummaries.get` на каждого
 * кандидата: в замерах аудита это ~101 обращение к IndexedDB за ход (40 + 32).
 * Один `getAll` вместо точечных чтений. Снимок живёт строго внутри вызова:
 * права («не показывать ИИ») и корзина проверяются по нему, поэтому между
 * ходами он не передаётся и протухать не может.
 */
export async function loadDocumentSnapshot(): Promise<Map<string, LocalDocument>> {
  const db = await getLocalDb();
  const docs = await db.getAll('documents');
  return new Map(docs.map(d => [d.id, d]));
}

export async function loadSummarySnapshot(): Promise<Map<string, AIDocumentSummary>> {
  const db = await getLocalDb();
  const summaries = await db.getAll('aiSummaries');
  return new Map(summaries.map(s => [s.documentId, s]));
}
