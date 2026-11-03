// DLG-Q10 (Fable T-15 + T-20): строка модели «что я изменил в посте» врёт — она
// пишет «ничего не изменено», хотя имя убрано, или «убрал ребёнка», хотя ребёнок
// добавлен. Код считает это надёжно. Строку модели из промпта при этом не
// убираем: без неё модель хуже держит приватность (§10.5 отчёта замера).

import { LB, RB, ROLE_STEMS, NAME_STOPWORDS, SENTENCE_HEAD_WORDS } from '../services/chatContext/personQuotes';
import { postKeepsForeignWords } from '../../../shared/ai/foreignSpeech';

export interface PostDiff {
  namesRemoved: string[];
  /** Имена, которые пост НЕ убрал — то, что автор обязан увидеть до публикации. */
  namesKept: string[];
  rolesAdded: string[];
  numbersRemoved: string[];
  /** LD-1: в посте назван клиент, пациент, сессия или терапия. */
  clientStoryInPost: boolean;
  /** MD-4: в теле поста остался фрагмент чужой прямой речи из заметки. */
  foreignSpeechInPost: boolean;
  /** 3.1 / 18.1(б): в одной фразе поста — близкий и деньги. */
  relativesMoneyInPost: boolean;
}

const lower = (s: string) => s.replace(/ё/g, 'е').toLowerCase();
const WORDS = /[А-ЯЁа-яё]{2,}|\d[\d\s.,:]{0,9}/g;
const LOWER_WORD = new RegExp(`${LB}([а-яё][а-яё]{2,})${RB}`, 'g');
const SENTENCE_START = new RegExp(
  '(?:^|[.!?…][\\s\\n]|\\n)\\s*$'
  // DR-4: в транскрипте реплика начинается после метки говорящего, а не после
  // точки. Без этого первое слово каждой реплики становилось кандидатом в имена,
  // и «Убраны имена» выдавало десятки обычных слов («Решила», «Кажется», «Важно»).
  // Метка — это начало строки, необязательный таймкод и слова до двоеточия.
  + '|(?:^|\\n)[ \\t]*(?:\\[?\\d{1,2}:\\d{2}(?::\\d{2})?\\]?[ \\t]+)?[^\\n:]{1,40}:[ \\t]*$',
);
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
function properNouns(text: string, rejectSentenceStart = false): string[] {
  const lowercaseForms = new Set([...text.matchAll(LOWER_WORD)].map(m => lower(m[1] ?? '')));
  const out: string[] = [];
  for (const m of text.matchAll(/[А-ЯЁ][а-яё]{2,}/g)) {
    const word = m[0];
    const lw = lower(word);
    if (NAME_STOPWORDS.has(lw)) continue;
    if (lowercaseForms.has(lw)) continue;
    if (SENTENCE_START.test(text.slice(0, m.index))) {
      // ED-2: на стороне поста начало фразы не разбираем вовсе — там с заглавной
      // стоит всё подряд («Вчера», «Каркас»), а ложное имя в предупреждении
      // дороже пропущенного.
      if (rejectSentenceStart) continue;
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
 * DR-4: слово поста короче трёх букв формой имени не считается. «Не», «Он», «Ах»
 * открывают каждую вторую фразу транскрипта и «переживали» любое имя на «Не-…»
 * («Неля» жила в посте со словом «Не»). Формула `min(длин) − 1` сохранена: без
 * неё падежная форма трёхбуквенного имени («Оля» → «Олю») переставала узнаваться,
 * а это закреплённый кейс R-4.
 */
function nameSurvives(postWord: string, name: string): boolean {
  if (!/^[А-ЯЁ]/.test(postWord)) return false;
  const a = lower(name), b = lower(postWord);
  // Беглая гласная: «Лев» в посте живёт как «Льва», «Льву», «Львом» — общего
  // начала с «лев» там нет, а имя не убрано. Дальше проверяется согласная после
  // «ь», иначе «льгота» или «львица» сошли бы за форму имени «Лев».
  if (b[0] === a[0] && b[1] === 'ь' && b[2] !== undefined && b[2] === a[2]) return true;
  if (b.length < 3) return false;
  if (b.length > a.length + 2) return false;
  const need = Math.max(2, Math.min(a.length, b.length) - 1);
  let shared = 0;
  while (shared < need && shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return shared >= need;
}

const NUMBER_RE = /(?:\d{1,3}[ \u00A0]\d{3}(?:[ \u00A0]\d{3})*|\d+(?:[.,:]\d+)?)/g;
const SUM_RE = /\d[\d\s.,:]{0,9}\s*(?:тыс\.?|руб(?:лей|ля|ль)?|₽|€|\$)/gi;
// DR-4: таймкоды транскрипта — не числа источника: пост, собранный из записи
// разговора, терял десятки «чисел» вида 00:12:03. Буквальное «пропускать любой
// \d{1,2}:\d{2}» выбросило бы и «напомнила про 5:50», которое закреплено в
// кейсах Q-10, поэтому время узнаёт по позиции: начало строки (в квадратных
// скобках или без) и полный формат чч:мм:сс в любом месте.
const LINE_TIMECODE = /^[ \t]*\[?\d{1,2}:\d{2}(?::\d{2})?\]?[ \t]*/gm;
const FULL_TIMECODE = /\b\d{1,2}:\d{2}:\d{2}\b/g;
const stripTimecodes = (s: string) => s.replace(LINE_TIMECODE, ' ').replace(FULL_TIMECODE, ' ');
// R7F-016: год — не сумма и не измеримое число, которое модель «убрала». Без
// этого «В 2024 году мы переехали» попадало в плашку «убраны числа: 2024», а
// человек читал это как потерю факта.
// \b перед кириллицей не помогает: `\w` — это латиница и цифры, поэтому
// «2024 году» конец слова проверяется отрицанием буквы, а не границей.
const YEAR_PHRASE = /(?:^|[^0-9а-яё])(?:1\d{3}|20\d{2})(?:\s*-\s*\d{2,4})?\s*(?:г[а-яё]*|лет)(?![а-яё])/gi;
const stripYears = (s: string) => s.replace(YEAR_PHRASE, ' ');

// LD-1: для автора, который работает с людьми, сеанс клиента — не «ещё один
// персонаж без имени», а чужая история в уязвимом положении. PRIVACY Редактора
// этого не покрывает, поэтому плашка предупреждает по маркеру слова. Правило в
// тексте промпта мерилось (10 прогонов на руку) и откатано: замер не сдвинулся.
const CLIENT_STORY_RE = new RegExp(
  `${LB}(?:клиент\\p{L}*|пациент\\p{L}*|терапи\\p{L}*|на сессии(?![а-яёА-ЯЁ])|сессия с(?![а-яёА-ЯЁ]))${RB}`,
  'iu',
);
const CLIENT_IN_NOTE_RE = /клиент|пациент/i;
// Исключение по заметке: сам автор был клиентом. Считается по двум оборотам —
// «у моего терапевта» (родительный) под них не попадает, и там предупреждение
// останется ложным: это известное слепое пятно правила.
const OWN_THERAPY_IN_SOURCE_RE = /мо(?:й|я|ему|ей) терапевт|на (?:свою|мою) терапию/i;
// DR-5: решает ПОСТ. Прежнее исключение смотрело на заметку: транскрипт СВОЕЙ
// сессии обычно содержит историю клиента (ту, что автор принёс), поэтому
// «нет слова о клиенте в заметке» не срабатывал, и пост о собственной терапии
// получал предупреждение про работу с клиентами.
const OWN_THERAPY_IN_POST = [
  /мо\p{L}* терапевт/iu,
  /терапевт\p{L}* (?:сказал|спросил|предложил|ответил|рассказал|посоветовал)/iu,
  /на (?:моей|своей) (?:сессии|терапии)/iu,
  /у меня на сессии/iu,
  /я (?:приш|прин)\p{L}* на сесси\p{L}*/iu,
];

/**
 * LD-1: пост упоминает работу с клиентами. Только тело поста — служебные строки
 * модели после «— — —» не считаются.
 */
export function mentionsClientStory(post: string, source: string): boolean {
  if (!CLIENT_STORY_RE.test(post)) return false;
  if (/клиент\p{L}*|пациент\p{L}*/iu.test(post)) return true;
  if (OWN_THERAPY_IN_POST.some(re => re.test(post))) return false;
  // Заметка по-прежнему решает один случай: своей терапией занят автор, и
  // клиентов в его записи нет вовсе.
  return !(OWN_THERAPY_IN_SOURCE_RE.test(source) && !CLIENT_IN_NOTE_RE.test(source));
}

// 3.1 / 18.1(б): чего близкие ждут от автора в деньгах — чужое, в пост не идёт.
// Строка в PRIVACY замер не сдвинула (10/10 → 10/10), поэтому плашка, как LD-1.
// «Дома» — анонимный близкий: модель, убрав «муж», пишет «дома сказали».
// Замер на готовых постах стенда arch-2026-10-11: S6d 136/136, прочие 0/614.
// ponytail: совпадение слов в одной фразе; свои деньги рядом с близким («купил
// маме») тоже предупредят — сузить, если плашка зашумит на живых постах.
const RELATIVE_RE = new RegExp(`${LB}(?:муж(?:а|у|ем|е|ья|ьям)?|жен(?:а|ы|е|у|ой)|партн[её]р\\p{L}*|супруг\\p{L}*|мам(?:а|ы|е|у|ой|очк\\p{L}*)|мать|матер\\p{L}*|пап(?:а|ы|е|у|ой)|от[её]ц|отц(?:а|у|ом|е)|родител\\p{L}*|сестр\\p{L}*|брат(?:а|у|ом|е|ья|ьев|ьям|ьями)?|доч(?:ь|ка|ки|ке|ку|кой|ер\\p{L}*)|сын(?:а|у|ом|е|овья|овей|ок)?|свекр\\p{L}*|т[её]щ\\p{L}*|бабушк\\p{L}*|дедушк\\p{L}*|семь(?:я|и|е|ю|ей)|дома|близк\\p{L}*)${RB}`, 'iu');
const MONEY_RE = new RegExp(`${LB}(?:деньг\\p{L}*|денег|денежн\\p{L}*|заработ\\p{L}*|зарабат\\p{L}*|зарплат\\p{L}*|доход\\p{L}*|ипотек\\p{L}*|кредит\\p{L}*|долг(?:а|и|ов|ам|у)?|алимент\\p{L}*|наследств\\p{L}*|бюджет\\p{L}*|рубл\\p{L}*|тысяч\\p{L}*|цен(?:а|у|ы|е|ой)|стоимост\\p{L}*|платит\\p{L}*|заплат\\p{L}*)${RB}`, 'iu');

export function mentionsRelativesMoney(post: string): boolean {
  return post.split(/[.!?…\n]+/).some(s => RELATIVE_RE.test(s) && MONEY_RE.test(s));
}

/**
 * Что пост Редактора сделал с заметкой: какие имена и числа из неё пропали,
 * какие имена остались и какие роли появились. `post` — текст ответа до строки
 * «— — —», `source` — тело заметки-источника.
 */
export function diffPostAgainstNote(
  post: string,
  source: string,
  opts: { selfName?: string | undefined } = {},
): PostDiff {
  const postWords = post.match(WORDS) ?? [];

  const sourceNames = properNouns(source);
  const namesRemoved = sourceNames
    .filter(name => !postWords.some(w => nameSurvives(w, name)));

  // ED-2: неубранное имя — ровно та дыра приватности, которую автор обязан
  // увидеть сам. Свои имена (профиль) чужими не считаем — так же, как
  // detectPersonMentions (R-5: сверка по каждому слову, «Имя Фамилия»), но
  // при этом сверяется форма имени, а не строка целиком: «с Олей» — это та же Оля.
  const selfNames = [...new Set((opts.selfName ?? '').split(/\s+/).map(lower).filter(Boolean))]
    .map(w => (w.charAt(0).toUpperCase() + w.slice(1)));
  const isSelf = (name: string) => selfNames.some(selfName => nameSurvives(name, selfName));

  const namesKept: string[] = [];
  const collect = (name: string) => {
    if (isSelf(name)) return;
    // Одно и то же имя в двух падежах не удваивает предупреждение.
    if (namesKept.some(kept => nameSurvives(name, kept) || nameSurvives(kept, name))) return;
    namesKept.push(name);
  };
  // ED-2: имя из заметки считается неубранным, только если оно подтверждено
  // позицией: хоть раз написано с заглавной НЕ в начале фразы — в заметке или в
  // посте. Без этого «Каркас держится» и «Спокойный тон» выходили в
  // предупреждение об именах (замер: 2 ложных на 20 постов).
  const corroborated = [...properNouns(source, true), ...properNouns(post, true)];
  const isCorroborated = (name: string) => corroborated.some(c => nameSurvives(c, name) || nameSurvives(name, c));
  for (const name of sourceNames) {
    if (postWords.some(w => nameSurvives(w, name)) && isCorroborated(name)) collect(name);
  }
  // Имена, приехавшие не из этой заметки (ход «добавь из других записей»).
  for (const name of properNouns(post, true)) collect(name);

  const rolePattern = (stems: string[]) => new RegExp(`${LB}(${stems.join('|')})${RB}`, 'i');
  const rolesAdded = ROLE_STEMS
    .filter(role => rolePattern(role.stems).test(post) && !rolePattern(role.stems).test(source))
    .map(role => role.key);

  const numbersFrom = stripYears(stripTimecodes(source));
  const numbersInto = stripYears(stripTimecodes(post));
  const numbersRemoved: string[] = [];
  for (const num of new Set([...numbersFrom.matchAll(NUMBER_RE)].map(m => m[0].trim()))) {
    if (!numbersInto.includes(num)) numbersRemoved.push(num);
  }
  for (const sum of new Set([...numbersFrom.matchAll(SUM_RE)].map(m => m[0].replace(/\s+/g, ' ').trim()))) {
    // R7F-016: «12 500 руб» — это число 12 500 и единица; прежний
    // `split(/\s/)[0]` давал «12», и дедуп не срабатывал: в плашке стояло и
    // «12 500», и «12 500 руб» за один и тот же факт.
    const bare = (sum.match(NUMBER_RE)?.[0] ?? sum).replace(/[\s\u00A0]+/g, ' ').trim();
    const plain = numbersRemoved.indexOf(bare);
    if (plain >= 0) {
      // Число уже попало в плашку без единицы измерения — оставляем более информативную
      // запись: «12 500 руб», а не «12 500».
      numbersRemoved[plain] = sum;
      continue;
    }
    if (!numbersInto.includes(sum) && !numbersInto.includes(bare)) numbersRemoved.push(sum);
  }

  return {
    namesRemoved,
    namesKept,
    rolesAdded,
    numbersRemoved,
    clientStoryInPost: mentionsClientStory(post, source),
    foreignSpeechInPost: postKeepsForeignWords(post, source),
    relativesMoneyInPost: mentionsRelativesMoney(post),
  };
}

/** Текст поста — всё до первой строки «— — —» (после неё служебные строки модели). */
export function postBody(answer: string): string {
  const at = answer.search(/^ *— — — *$/m);
  return at < 0 ? answer : answer.slice(0, at);
}
