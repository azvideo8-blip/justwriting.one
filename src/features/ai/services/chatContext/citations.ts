// AUDIT-M3: `[#id]` в тексте заметки/памяти не должен открывать цитирование
// исключённых из AI или несуществующих документов — id валидируются по корпусу.

const CITATION_RE = /\[#([a-zA-Z0-9_-]+)\]/g;

export function extractCitationIds(content: string): string[] {
  const ids: string[] = [];
  for (const m of content.matchAll(CITATION_RE)) {
    if (m[1]) ids.push(m[1]);
  }
  return ids;
}

import { isExcludedFromAI, type ExcludableDoc } from '../../utils/isExcludedFromAI';

export type CitableDoc = ExcludableDoc;

export async function validateCitationIds(
  ids: readonly string[],
  lookup: (id: string) => Promise<CitableDoc | undefined>,
): Promise<string[]> {
  const valid: string[] = [];
  for (const id of ids) {
    try {
      const cited = await lookup(id);
      if (cited && !isExcludedFromAI(cited)) valid.push(id);
    } catch { /* ignore */ }
  }
  return valid;
}

// DLG-Q8: названия заметок, которые модель видела в этом ходе. Нужны, чтобы
// отличить законную ссылку «в заметке «Письмо маме»» от выдуманной: модель
// называет записями те, которых в материалах нет.
// Формы заголовков: шапка результата поиска (с номером и без — сравнение
// периодов печатает `Заметка "Название":`), строка «недавних записей» и маркер
// приложенной заметки (`Прикреплена` / `Прикрепленная`).
const CONTEXT_TITLE_PATTERNS: RegExp[] = [
  /Заметка\s+(?:\d+:\s*)?"([^"\n]{1,200})"/g,
  /^-\s*«([^»\n]{1,200})»:/gm,
  /\[Прикреплен(?:а|ная) заметка:\s*"([^"\n]{1,200})"\]/g,
];

export function extractContextTitles(text: string | null | undefined): string[] {
  if (!text) return [];
  const titles: string[] = [];
  for (const re of CONTEXT_TITLE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const t = (m[1] ?? '').trim();
      if (t) titles.push(t);
    }
  }
  return [...new Set(titles)];
}
