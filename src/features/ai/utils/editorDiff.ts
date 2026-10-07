// DLG-Q10 (Fable T-15 + T-20): строка модели «что я изменил в посте» врёт — она
// пишет «ничего не изменено», хотя имя убрано, или «убрал ребёнка», хотя ребёнок
// добавлен. Код считает это надёжно. Строку модели из промпта при этом не
// убираем: без неё модель хуже держит приватность (§10.5 отчёта замера).

import { LB, RB, ROLE_STEMS, NAME_STOPWORDS } from '../services/chatContext/personQuotes';

export interface PostDiff {
  namesRemoved: string[];
  rolesAdded: string[];
  numbersRemoved: string[];
}

const lower = (s: string) => s.replace(/ё/g, 'е').toLowerCase();
const WORDS = /[А-ЯЁа-яё]{2,}|\d[\d\s.,:]{0,9}/g;

/**
 * Основа слова для сверки падежей: «Оля» и «Олю» — один человек. Полное совпадение
 * слова для этого не годится, а жадиная маска ловит «олень» вместо «Оля», поэтому
 * сравниваем основы как префиксы друг друга.
 */
function root(w: string): string {
  const n = lower(w).replace(/[^а-яе]/g, '');
  return n.slice(0, Math.max(2, n.length - 2));
}

function sameWord(a: string, b: string): boolean {
  const ra = root(a), rb = root(b);
  return ra === rb || (Math.min(ra.length, rb.length) >= 2 && (ra.startsWith(rb) || rb.startsWith(ra)));
}

/** Слово с заглавной в середине фразы — кандидат на имя. */
function properNouns(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[А-ЯЁ][а-яё]{2,}/g)) {
    const w = m[0];
    if (NAME_STOPWORDS.has(lower(w))) continue;
    const before = text.slice(0, m.index);
    if (before.trim() === '' || /[.!?…][\s\n]$/.test(before) || /\n\s*$/.test(before)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

const NUMBER_RE = /(?:\d{1,3}[ \u00A0]\d{3}(?:[ \u00A0]\d{3})*|\d+(?:[.,:]\d+)?)/g;
const SUM_RE = /\d[\d\s.,:]{0,9}\s*(?:тыс\.?|руб(?:лей|ля|ль)?|₽|€|\$)/gi;

/**
 * Что пост Редактора сделал с заметкой: какие имена и числа из неё пропали и
 * какие роли появились. `post` — текст ответа до строки «— — —», `source` —
 * тело заметки-источника.
 */
export function diffPostAgainstNote(post: string, source: string): PostDiff {
  const postWords = post.match(WORDS) ?? [];

  const namesRemoved = properNouns(source)
    .filter(name => !postWords.some(w => sameWord(w, name)));

  const rolePattern = (stems: string[]) => new RegExp(`${LB}(${stems.join('|')})${RB}`, 'i');
  const rolesAdded = ROLE_STEMS
    .filter(role => rolePattern(role.stems).test(post) && !rolePattern(role.stems).test(source))
    .map(role => role.key);

  const numbersRemoved: string[] = [];
  for (const num of new Set([...source.matchAll(NUMBER_RE)].map(m => m[0].trim()))) {
    if (!post.includes(num)) numbersRemoved.push(num);
  }
  for (const sum of new Set([...source.matchAll(SUM_RE)].map(m => m[0].replace(/\s+/g, ' ').trim()))) {
    const bare = sum.split(/\s/)[0]!;
    if (numbersRemoved.includes(bare)) continue;
    if (!post.includes(sum) && !post.includes(bare)) numbersRemoved.push(sum);
  }

  return { namesRemoved, rolesAdded, numbersRemoved };
}

/** Текст поста — всё до первой строки «— — —» (после неё служебные строки модели). */
export function postBody(answer: string): string {
  const at = answer.search(/^ *— — — *$/m);
  return at < 0 ? answer : answer.slice(0, at);
}
