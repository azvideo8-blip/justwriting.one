import { getLocalDb } from '../../../../core/storage/localDb';
import type { LocalDocument, AIDocumentSummary } from '../../../../core/storage/localDb';
import { isExcludedFromAI } from '../isExcludedFromAI';

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

/**
 * TR-9 (владелец 13.11): номера заметок, которые человек отдал ИИ разбором —
 * у них есть сводка. Неразобранная заметка не попадает в разговор ни одним
 * путём: ни поиском по словам, ни по смыслу (старый вектор), ни по имени.
 * Исключение одно — заметка, приложенная к ходу вручную: её человек отдал сам,
 * и она идёт мимо этого правила (блоки хода, `hideExcludedNotes`).
 * Сводку удалили («Удалить разбор ИИ») — заметка снова не видна.
 */
export async function loadAnalysedIds(): Promise<Set<string>> {
  const db = await getLocalDb();
  return new Set((await db.getAllKeys('aiSummaries')).map(String));
}

/**
 * R7Q-019/R7F-010: номера заметок, доступных ИИ, — и локальный id, и постоянный
 * uuid. Производные (хронология, доказательства тем, сюжетные линии) ссылаются на
 * заметку то одним, то другим, а на второе устройство строка приезжает с чужим
 * локальным id — там «заметки нет», и по тому же правилу S-51 она не показывается.
 * Снимок читается на каждый ход, поэтому сокрытие заметки видно сразу, даже если
 * чистка производных на этом устройстве не дошла.
 */
export async function loadVisibleNoteKeys(): Promise<Set<string>> {
  const db = await getLocalDb();
  const keys = new Set<string>();
  // TR-9: «доступна ИИ» = не скрыта И разобрана. Отсюда читают поиск по словам,
  // сборка граней и производные — неразобранная не видна никому из них.
  const analysed = await loadAnalysedIds();
  for (const d of await db.getAll('documents')) {
    if (isExcludedFromAI(d) || !analysed.has(d.id)) continue;
    if (d.id) keys.add(d.id);
    if (d.uuid) keys.add(d.uuid);
  }
  return keys;
}
