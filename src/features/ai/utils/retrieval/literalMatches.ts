import { LocalVersionService } from '../../../../core/services/LocalVersionService';

/**
 * Candidates whose text literally contains a quoted phrase or a name from the
 * query. Local, so it costs nothing next to the cloud rerank it lets us skip.
 *
 * Names are matched by stem: the query says «про Сашу» while the note says
 * «Саша» or «Сашей». Стем обрезает ДВА окончания и матчится по границе слова —
 * раньше «Она»→«он» через голый includes() матчила «конь» и «поклон», шум
 * почти всегда делал hits непустым и глушал облачный реранкер.
 */
// Экспорт ради TEST-1 §2.4: тест ведёт настоящий вызов, а не копию логики.
export async function findLiteralMatches(query: string, ids: string[]): Promise<Set<string>> {
  const hits = new Set<string>();
  const quotes = extractQuotes(query);
  // Именованная сущность = слово с заглавной ≥5 букв («Она» в начале
  // предложения не считается). После фильтра в стеме только кириллица,
  // так что RegExp из него безопасен без экранирования.
  // ≥4 букв всего (иначе «Саша»/«Сашу» отсекаются), стем ≥3.
  // TEST-1 §2.4 поймал исходный порог {4,} и жёсткий slice(-2).
  const CYR_NAME_RE = /^[А-ЯЁ][а-яё]{3,}$/;
  const needles = extractNamedEntities(query)
    .filter(e => CYR_NAME_RE.test(e))
    .flatMap(e => [e.slice(0, -1), ...(e.length >= 6 ? [e.slice(0, -2)] : [])])
    .filter(stem => stem.length >= 3);
  if (quotes.length === 0 && needles.length === 0) return hits;

  const stemHit = (haystackLower: string, stem: string): boolean =>
    new RegExp(`(?:^|[^а-яё])${stem}[а-яё]{0,3}(?:[^а-яё]|$)`, 'i').test(haystackLower);

  for (const id of ids.slice(0, 10)) {
    let content = '';
    try { content = await LocalVersionService.getLatestContent(id); } catch { /* ignore */ }
    if (!content) continue;
    const lc = content.toLowerCase();
    if (quotes.some(q => lc.includes(q)) || needles.some(n => stemHit(lc, n))) {
      hits.add(id);
    }
  }
  return hits;
}

export function extractQuotes(text: string): string[] {
  const quotes: string[] = [];
  const regex = /["'«„]([^"'»“]+)["'»“]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]?.trim()) {
      quotes.push(match[1].trim().toLowerCase());
    }
  }
  return quotes;
}

function extractNamedEntities(query: string): string[] {
  const words = query.split(/[\s,.:;!?()"\-«»„“]+/);
  const entities: string[] = [];
  for (const w of words) {
    if (/^[А-ЯA-Z][а-яa-zа-яёА-ЯЁa-zA-Z]*$/.test(w)) {
      // Исходный регистр сохраняется: именованность = заглавная буква
      // (находка TEST-1 §2.4: toLowerCase() убивал признак для CYR_NAME_RE).
      if (w.length >= 4) {
        entities.push(w);
      }
    }
  }
  return entities;
}
