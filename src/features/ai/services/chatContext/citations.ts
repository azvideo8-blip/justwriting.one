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
