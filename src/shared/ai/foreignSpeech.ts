/**
 * MD-4 (0.9.38): чужая прямая речь в заметке.
 *
 * Редактор делает пост из заметки, где есть эпизод с другим человеком, и переносит
 * в пост его слова, детали и имя — на стенде arch-2026-10-11 это S6: 12 из 12 на
 * пяти моделях и всех промптах. Правило в тексте промпта мерилось и стало хуже
 * (LD-1: 1 → 4 из 10). Здесь — детектор, на котором держится плашка Редактора
 * (`editorDiff` → `foreignSpeechInPost`). Вторая правка той же партии — пометка
 * абзацев `[чужой эпизод]` внутри ограды данных — измерена и откатана: с ней
 * чужая реплика в посте стоит на месте (24/24 → 24/24), а S1 ухудшилась вдвое.
 * Реализация и таблица замера — в
 * `audit-evidence/ai-dialogue-quality-fable/arch-2026-10-11/md4-marking-reverted/`.
 *
 * Чужая прямая речь — кавычки, перед которыми в этой же фразе стоит глагол речи
 * в третьем лице («сказала», «спросил», «добавила», …), а подлежащее — не «я».
 * «Я сказала: „…"» — речь автора. Если подлежащее в фразе пропущено («Сказала:
 * „…"», что в дневнике норма), смотрим на ближайшее названное до цитаты: «Я
 * ответила … Сказала ему: „…"» — автор, «Она повернулась … Сказала: „…"» — другой
 * человек. Глаголы первого лица («Говорю: „…"») в список не входят намеренно: не
 * совпал глагол — нет и предупреждения, то есть неясный случай решает в сторону
 * молчания, а не ложной плашки.
 *
 * Порог — 4 слова, как у плашки и у проверки S5: короткие кавычки это метки и
 * термины, а не реплика человека.
 */

import { normalizeQuoteText, quoteSpans } from './quoteGuard';

const MIN_WORDS = 4;
/** Сколько знаков может стоять между глаголом речи и кавычкой («ответила как
 *  учитель: „…"»). Больше — уже другая конструкция. */
const VERB_GAP = 40;
/** Как далеко назад искать названное подлежащее, если в фразе его нет. */
const SUBJECT_LOOKBACK = 200;

const SPEECH_VERBS = [
  'сказал[аи]?|скажет',
  'говорил[аи]?|говорит|говорят',
  'спросил[аи]?|спрашивал[аи]?|спрашивает|спросит|спросят',
  'ответил[аи]?|отвечал[аи]?|отвечает',
  'добавил[аи]?|добавлял[аи]?|добавляет',
  'крикнул[аи]?|кричит',
  'произнес[аи]?|прошептал[аи]?|шепчет',
  'попросил[аи]?|просил[аи]?|просит|просят',
  'возразил[аи]?|возражает',
  'напомнил[аи]?|напоминает',
  'повторил[аи]?|повторяет',
  'заметил[аи]?|замечает',
  'объяснил[аи]?|объясняет',
  'пообещал[аи]?|обещает',
  'признал[аи]?',
  'бросил[аи]?|бросает',
];

// Границы слова для кириллицы: `\b` в JS считает словами только латиницу и
// цифры, а с ним «сказала» не совпало бы ни разу.
const L = '(?:^|[^а-яёА-ЯЁ])';
const R = '(?![а-яёА-ЯЁ])';
const SPEECH_VERB_RE = new RegExp(`${L}(?:${SPEECH_VERBS.join('|')})${R}`, 'i');
const SELF_RE = new RegExp(`${L}(?:я|мы)${R}`, 'i');
const OTHER_RE = new RegExp(`${L}(?:он|она|оно|они)${R}`, 'i');
const PHRASE_BREAKS = ['.', '!', '?', '…', '\n'];

/** Начало текущей фразы: всё после ближайшего знака конца фразы. */
function currentPhrase(before: string): string {
  const cut = Math.max(...PHRASE_BREAKS.map(c => before.lastIndexOf(c)));
  return before.slice(cut + 1);
}

function tail(s: string, n: number): string {
  return s.slice(Math.max(0, s.length - n));
}

function wordsOf(s: string): string[] {
  return normalizeQuoteText(s).split(' ').filter(Boolean);
}

/** Текст без чужих кавычек: в них «я» — это «я» говорящего, а не подлежащее. */
function withoutQuotes(text: string): string {
  let out = text;
  for (const span of quoteSpans(text)) out = out.replace(span.text, ' ');
  return out;
}

/**
 * Речь ли это автора. Знак решает порядок: если в самой фразе подлежащего нет,
 * берём ближайшее названное до неё.
 */
function isSelfSpeech(phrase: string, before: string): boolean {
  if (SELF_RE.test(phrase)) return true;
  if (OTHER_RE.test(phrase)) return false;
  const back = withoutQuotes(tail(before.slice(0, Math.max(0, before.length - phrase.length)), SUBJECT_LOOKBACK));
  const self = lastMatch(back, SELF_RE);
  const other = lastMatch(back, OTHER_RE);
  if (self < 0 && other < 0) return false;
  return self > other;
}

function lastMatch(text: string, re: RegExp): number {
  let at = -1;
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
    at = m.index ?? at;
  }
  return at;
}

/**
 * Реплики других людей в тексте: «Соня сказала: „…"» — да, «Я сказала: „…"» — нет.
 * Работает и обратный порядок: «„Давай“, — сказала она».
 */
export function foreignSpeechQuotes(text: string): string[] {
  const out: string[] = [];
  for (const span of quoteSpans(text)) {
    if (wordsOf(span.inner).length < MIN_WORDS) continue;
    const before = text.slice(0, span.at);
    const phrase = currentPhrase(before);
    const after = text.slice(span.at + span.text.length, span.at + span.text.length + VERB_GAP);

    const afterIsVerb = SPEECH_VERB_RE.test(after);

    if (SPEECH_VERB_RE.test(tail(phrase, VERB_GAP))) {
      if (!isSelfSpeech(phrase, before)) out.push(span.inner);
    } else if (afterIsVerb && !SELF_RE.test(phrase) && !OTHER_RE.test(phrase)) {
      // Обратный порядок: подлежащее стоит после глагола — «, — сказала она».
      if (!SELF_RE.test(after)) out.push(span.inner);
    }
  }
  return out;
}

/**
 * Осталась ли в посте чужая реплика: фрагмент её речи от 4 слов стоит в теле
 * поста так же, как в заметке. Регистр, ё/е, кавычки и пунктуация не решают.
 */
export function postKeepsForeignWords(post: string, source: string): boolean {
  const hay = normalizeQuoteText(post);
  if (!hay) return false;
  for (const quote of foreignSpeechQuotes(source)) {
    const words = wordsOf(quote);
    for (let i = 0; i + MIN_WORDS <= words.length; i++) {
      if (hay.includes(words.slice(i, i + MIN_WORDS).join(' '))) return true;
    }
  }
  return false;
}
