import { isExcludedFromAI, type ExcludableDoc } from './isExcludedFromAI';
import { extractCitationIds } from '../services/chatContext/citations';

export interface CitableNoteDoc extends ExcludableDoc {
  id: string;
  uuid?: string | undefined;
  linkedCloudId?: string | undefined;
}

/** Проверка «эту заметку ИИ видеть нельзя» по номеру из цитаты. */
export interface HiddenNoteIds {
  has(id: string): boolean;
  /** > 0 — фильтр действует (совместимо с прежним `Set`). */
  readonly size: number;
}

/**
 * AP-2 + приёмка ai-privacy (код-ревью, I-3): скрытой считается любая заметка,
 * которая НЕ разрешается в видимую на этом устройстве — по локальному номеру,
 * uuid или облачному номеру. Не только помеченная «скрыть», но и удалённая
 * навсегда, и заметка с другого устройства (там свои локальные номера) — то же
 * правило, что S-51: «нет заметки» = «нельзя». Пересказ без доказанно видимого
 * источника модели не уходит.
 */
export function hiddenNoteIdsFromDocs(docs: ReadonlyArray<CitableNoteDoc>): HiddenNoteIds {
  const visible = new Set<string>();
  for (const d of docs) {
    if (isExcludedFromAI(d)) continue;
    visible.add(d.id);
    if (d.uuid) visible.add(d.uuid);
    if (d.linkedCloudId) visible.add(d.linkedCloudId);
  }
  return { has: (id: string) => !visible.has(id), size: 1 };
}

/** Чтение не удалось: «нет ответа» не значит «видно» — скрыто всё. */
export const ALL_NOTES_HIDDEN: HiddenNoteIds = { has: () => true, size: 1 };

/**
 * Приёмка ai-privacy (Vuln 3): цитирует ли текст скрытую заметку — для служебных
 * запросов, которые шлют модели кусок старого ответа (подсказки следующего
 * вопроса). Не прочиталась база — `true`: «нет ответа» не значит «не скрыта».
 */
export async function citesHiddenNote(
  text: string,
  loadDocs: () => Promise<ReadonlyArray<CitableNoteDoc>>,
  /** Заметка-тема диалога: скрыта — ответ о ней не уходит, даже без ссылки. */
  topicDocId?: string | null,
): Promise<boolean> {
  const ids = extractCitationIds(text);
  if (topicDocId) ids.push(topicDocId);
  if (ids.length === 0) return false;
  try {
    const hidden = hiddenNoteIdsFromDocs(await loadDocs());
    return ids.some(id => hidden.has(id));
  } catch {
    return true;
  }
}
