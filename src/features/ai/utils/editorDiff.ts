// DLG-Q10 (Fable T-15 + T-20): строка модели «что я изменил в посте» врёт — она
// пишет «ничего не изменено», хотя имя убрано, или «убрал ребёнка», хотя ребёнок
// добавлен. Код считает это надёжно. Строку модели из промпта при этом не
// убираем: без неё модель хуже держит приватность (§10.5 отчёта замера).

import { LB, RB, ROLE_STEMS, NAME_STOPWORDS, SENTENCE_HEAD_WORDS } from '../services/chatContext/personQuotes';

export interface PostDiff {
  namesRemoved: string[];
  rolesAdded: string[];
  numbersRemoved: string[];
}

const lower = (s: string) => s.replace(/ё/g, 'е').toLowerCase();
const WORDS = /[А-ЯЁа-яё]{2,}|\d[\d\s.,:]{0,9}/g;
const LOWER_WORD = new RegExp(`${LB}([а-яё][а-яё]{2,})${RB}`, 'g');
const SENTENCE_START = /(?:^|[.!?…][\s\n]|\n)\s*$/;
// Начало фразы — место, где с заглавной стоит всё подряд, а не только имена.
// Окончания делятся на две группы (S-2, ревью 2):
// · не-именные всегда: инфинитивы и возвратные (-ть, -ться, -сь, -ся, -ти),
//   наречия и краткие формы (-но, -ко), личные 1/2 лица (-у, -ю, -ешь, -ишь) —
//   такие имена в именительном не кончаются;
// · двусмысленные: мужское прошедшее (-л, -ла, -ло, -ли) и личные формы
//   (-ет, -ит, -ут, -ют, -ем, -им) — под них попадают Максим, Артём, Мила, Павел.
//   Здесь решает следующее слово: после имени в дневнике стоит глагол, после
//   глагола — существительное или наречие.
const NEVER_A_NAME_ENDING = /(?:ться|сь|ся|ть|ти|но|ко|у|ю|ешь|ишь)$/;
const AMBIGUOUS_NAME_ENDING = /(?:л|ла|ло|ли|ет|ит|ут|ют|ем|им)$/;
// Конечная форма личного глагола (инфинитив на -ть сюда НЕ входит: «Хотим уехать»
// — это не имя).
const VERB_LIKE_ENDING = /(?:л|ла|ло|ли|ет|ит|ут|ют|ем|им|ешь|ишь)$/;
// Список начал фразы свёрнут так же, как lower(): иначе «Днём» сверяется с
// «днём» и не совпадает.
const SENTENCE_HEAD_FOLDED = new Set([...SENTENCE_HEAD_WORDS].map(lower));

/** Стоит ли в ближайших двух словах после кандидата личная глагольная форма. */
function followedByVerb(text: string, wordEnd: number): boolean {
  const rest = text.slice(wordEnd).replace(/^[^\p{L}]+/u, '');
  const nextTwo = rest.split(/[^\p{L}]+/u).filter(Boolean).slice(0, 2).map(lower);
  return nextTwo.some(w => VERB_LIKE_ENDING.test(w));
}

/**
 * Кандидаты в имена: слова с заглавной, не из стоп-листа и ни разу не виденные в
 * источнике со строчной («Оля» — имя, «Сегодня» — нет). Начало предложения — тоже
 * кандидат: в дневнике имя чаще всего стоит именно там, и прежний пропуск начала
 * фразы терял почти все имена (R-4).
 */
function properNouns(text: string): string[] {
  const lowercaseForms = new Set([...text.matchAll(LOWER_WORD)].map(m => lower(m[1] ?? '')));
  const out: string[] = [];
  for (const m of text.matchAll(/[А-ЯЁ][а-яё]{2,}/g)) {
    const word = m[0];
    const lw = lower(word);
    if (NAME_STOPWORDS.has(lw)) continue;
    if (lowercaseForms.has(lw)) continue;
    if (SENTENCE_START.test(text.slice(0, m.index))) {
      if (SENTENCE_HEAD_FOLDED.has(lw) || NEVER_A_NAME_ENDING.test(lw)) continue;
      if (AMBIGUOUS_NAME_ENDING.test(lw) && !followedByVerb(text, m.index + word.length)) continue;
    }
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

/**
 * Имя осталось в посте, если там есть слово с заглавной буквы с тем же началом:
 * общее начало не короче `max(2, min(длин) − 1)` и слово не длиннее имени больше
 * чем на две буквы. Строчные «олень», «анализ», «лето» не подходят — за имя
 * отвечает заглавная, а «Анализ» отсекает ограничение по длине.
 */
function nameSurvives(postWord: string, name: string): boolean {
  if (!/^[А-ЯЁ]/.test(postWord)) return false;
  const a = lower(name), b = lower(postWord);
  // Беглая гласная: «Лев» в посте живёт как «Льва», «Льву», «Львом» — общего
  // начала с «лев» там нет, а имя не убрано. Дальше проверяется согласная после
  // «ь», иначе «льгота» или «львица» сошли бы за форму имени «Лев».
  if (b[0] === a[0] && b[1] === 'ь' && b[2] !== undefined && b[2] === a[2]) return true;
  if (b.length > a.length + 2) return false;
  const need = Math.max(2, Math.min(a.length, b.length) - 1);
  let shared = 0;
  while (shared < need && shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return shared >= need;
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
    .filter(name => !postWords.some(w => nameSurvives(w, name)));

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
