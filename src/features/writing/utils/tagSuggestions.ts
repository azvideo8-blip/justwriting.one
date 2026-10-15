// SA-24: на телефоне подсказки тегов в «Записано.» — только из тегов, которые у
// человека уже есть и которые совпали с текстом. Словоформы из самого текста
// («послушной», «впервые», «неделю») на тяжёлой записи вынесли бы наверх
// самые частые, то есть самые больные слова, крупными чипами.

const WORD_RE = /[а-яёa-z]+/gi;

/** Грубая основа: без «ё»; от пяти знаков отбрасываются два последних, у четырёх —
 *  один. «глина / глину» → «гли», «утро / утром» → «утр». Промах предпочтительнее
 *  ложного совпадения. */
export function stem(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  if (w.length >= 5) return w.slice(0, w.length - 2);
  return w.length === 4 ? w.slice(0, 3) : w;
}

/** Не больше `limit` существующих тегов, чьи слова (по основе) все есть в тексте;
 *  чаще встречающиеся — первыми. */
export function suggestExistingTags(content: string, existing: string[], limit = 2): string[] {
  const counts = new Map<string, number>();
  for (const w of content.match(WORD_RE) ?? []) {
    const s = stem(w);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const scored: { tag: string; score: number }[] = [];
  const seen = new Set<string>();
  for (const raw of existing) {
    const tag = raw.replace(/^#+/, '').trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    const words = tag.match(WORD_RE) ?? [];
    if (words.length === 0) continue;
    const hits = words.map(w => counts.get(stem(w)) ?? 0);
    if (hits.some(h => h === 0)) continue;
    scored.push({ tag, score: hits.reduce((a, b) => a + b, 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag)).slice(0, limit).map(s => s.tag);
}
