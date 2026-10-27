/**
 * MD-3 (0.9.38): кавычка — только для дословного.
 *
 * Модель ставит кавычки вокруг пересказа, гипотезы и склейки из двух мест:
 * на стенде arch-2026-10-11 это S5 — 19 провалов из 24 на v4-flash и 7 из 12 на
 * v4.1-flash, плюс живые находки 1.5, 2.1, 5.5, 6.1. Правило в промпте есть с
 * 0.9.35; два шага и более строгие промпты чисел не сдвинули. Значит — код после
 * ответа: цитата, которой нет в материалах хода, теряет кавычки. Слова остаются.
 * DG-3 (живые 10.7, 11.2, 13.2): у снятой РЕЧИ — после глагола речи или от
 * первого/второго лица — без кавычек терялось, чья она, и реплика другого
 * человека читалась как слова автора. Такая цитата получает «по смыслу:».
 *
 * Сверка — по свёрнутому тексту (как `squash()` стенда): регистр, ё/е, любые
 * виды кавычек, пунктуация и пробелы. Урок R-1: цитата, которая в материалах
 * есть, обязана пережить правку при любом оформлении и переносе строк.
 *
 * Кавычки в 1–3 слова не трогаются: это метки и термины, а не речь человека.
 * Исключение (находки 10.6, 11.3): короткая цитата, поданная как слова человека
 * («ты пишешь «…»», «называешь это «…»»), сверяется так же, как длинная.
 */

import { FORMAT_CONTROLS } from './sameWords';

// Кавычки любых видов (включая „немецкие“ и одиночные) при сверке не считаются.
const QUOTE_CHARS = /[«»„“”"'‘’`]/g;

/** Три формы кавычек одной реплики; вложенность «…» внутри «…» допускается. */
// R7Q-023: третья ветка — прямые кавычки — раньше не умела ни переноса строки,
// ни длины больше 400 знаков. Выдуманная цитата такого формата стражем просто не
// виделась и сохраняла кавычки. Класс `[^"]+` линеен, потолка нет, перенос разрешён.
const QUOTE_SPAN_RE = /«((?:[^«»]|«[^«»]*»)*)»|“((?:[^“”]|“[^“”]*”)*)”|"([^"]+)"/g;

const MIN_WORDS = 4;
const MIN_SPEECH_WORDS = 2;

// Перед короткой цитатой — глагол речи о человеке: «пишешь», «сказала»,
// «называешь», «твоими словами». Целым словом: «разговор» — не «говоришь».
// Окно в 40 знаков до открывающей кавычки.
const SPEECH_CUE_RE = /(?:^|[^а-яё])(?:пишешь|написала?|писала?|говоришь|сказала?|называешь|назвала?|формулируешь|твоими словами|твои слова)[^.!?«»“”"\n]{0,40}$/;

// DG-3: речь — глагол речи о ком угодно перед цитатой или 1–2 лицо внутри неё.
const SPEECH_VERBS = 'пишешь|пишет|написала?|написали|писала?|говоришь|говорит|говорила?|говорили|сказала?|сказали|ответила?|ответили|спросила?|спросили|добавила?|добавили|решила?|решили|заявила?|заявили|назвала?|называешь|формулируешь|произнесла|произн[её]с|твоими словами|твои слова';
const SPEECH_ANY_RE = new RegExp(`(?:^|[^а-яё])(?:${SPEECH_VERBS})[^.!?«»“”"\\n]{0,40}$`);
// DY4: «…», — решила она. Глагол речи сразу после цитаты (через тире).
const SPEECH_AFTER_RE = new RegExp(`^[ \\t,]*[—–-][ \\t]*(?:${SPEECH_VERBS})(?:[^а-яё]|$)`);
const PERSONAL_RE = /(?:^|[^а-яё])(?:я|мне|меня|мной|мой|моя|мо[её]|мои|моих|ты|тебе|тебя|тобой|твой|твоя|тво[её]|твои|мы|нам|нас|наш|наша)(?=[^а-яё]|$)/;

/** Текст для сверки: регистр, ё/е, кавычки, пунктуация и пробелы свёрнуты. */
export function normalizeQuoteText(s: string): string {
  return s
    // R7F-013: NFD («е» + U+0301 вместо «ё») и форматирующие символы внутри
    // цитаты не совпадали с материалом, и страж снимал кавычки с ПОДЛИННОЙ
    // цитаты. NFC и зачистка Cf ставятся до сравнивания, а не после.
    .normalize('NFC')
    .replace(FORMAT_CONTROLS, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(QUOTE_CHARS, '')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

export interface QuoteSpan {
  /** Позиция открывающей кавычки. */
  at: number;
  /** Цитата вместе с кавычками. */
  text: string;
  /** Содержимое внутри кавычек. */
  inner: string;
}

/** Все кавычки текста с позициями — тот же шаблон, что у стража и у детектора
 *  чужой речи (MD-4), чтобы две правки не разошлись в том, что считать цитатой. */
export function quoteSpans(text: string): QuoteSpan[] {
  const out: QuoteSpan[] = [];
  for (const m of text.matchAll(QUOTE_SPAN_RE)) {
    const inner = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    out.push({ at: m.index ?? 0, text: m[0], inner });
  }
  return out;
}

/**
 * Снимает кавычки с цитат от 4 слов, которых нет в `materials`. Возвращает и
 * список снятого — по нему считается `quote_unquoted` для `[chat-end]`.
 * Без материалов (`materials` пуст) правило молчит: сверять не с чем, а молча
 * снять кавычки с верной цитаты хуже, чем оставить выдуманные.
 */
/**
 * ED-1 (0.10.8): у Редактора предложенная строка написана от лица автора, и
 * ветка `PERSONAL_RE` вешала на неё «по смыслу» — как будто слова автора
 * переданы неточно. `markPersonal: false` отключает эту ветку: у Редактора
 * метка ставится только по глаголу речи перед цитатой. Снятие кавычек с
 * отсутствующих — прежнее, правило MD-3 не трогается.
 */
export interface UnquoteOptions {
  markPersonal?: boolean;
}

/**
 * DY4 (живой 15.1): сколько слов цитаты идут в материалах по порядку в одном
 * окне — наибольшая общая подпоследовательность с отрезком материалов длиной
 * `span`, начатым на слове цитаты. Без потерь отрицания: окно, где «не/ни/нет»
 * больше или меньше, чем в цитате, не считается («я тебя не люблю» ≠ «я тебя
 * люблю»). ponytail: O(окна·n·span) — поэтому только для цитат до
 * FUZZY_MAX_WORDS слов (ревью 0.10.10: 60 слов на 9 тыс. слов материалов — 0,65 с
 * на каждый чанк потока); длиннее — прежнее точное сравнение.
 */
const FUZZY_MAX_WORDS = 30;
const NEGATIONS = new Set(['не', 'ни', 'нет']);
const negations = (ws: string[]) => ws.filter(w => NEGATIONS.has(w)).length;

/**
 * DL-19 (19.3): граница фразы в материалах. Раньше сверка шла по всему свёрнутому
 * тексту, а пунктуация при сворачивании исчезает — и цитата, собранная из хвоста
 * одной фразы и начала следующей, находилась в материалах целиком и проходила
 * страж как дословная. На стенде arch-2026-10-11 (семья S11, расшифровка 30–34 тыс.
 * знаков) так прошло 12 цитат в 9 ответах из 30. Теперь и точное, и «почти
 * дословно» сравнивается внутри одной фразы: слова остаются, кавычки снимаются.
 *
 * Фраза — от точки/вопроса/восклицания/многоточия до неё, а также от пустой строки.
 * Одиночный перенос строки фразу НЕ заканчивает: цитата, в которой материал
 * перенесён по ширине, обязана пережить правку (урок R-1).
 */
const PHRASE_SPLIT = /\n[ \t]*\n|(?<=[.!?…])[ \t\n]+/;

interface Phrase {
  /** Свёрнутый текст фразы — по нему точное сравнение. */
  text: string;
  /** Те же слова массивом — для порядка. */
  words: string[];
}

// Дейлик 27.10 Н-3: строки шапки блока («[#id · дата]», «[Прикреплена заметка: …]»)
// — граница фразы, а не начало первой фразы заметки. Иначе цитата через конец
// одной заметки и начало следующей не находилась в материалах.
const BLOCK_HEAD_LINE = /^[ \t]*\[(?:#[^\]\n]*|Прикреплена заметка: [^\n]*)\][ \t]*$/gm;

function phrasesOf(materials: string): Phrase[] {
  const out: Phrase[] = [];
  for (const raw of materials.replace(BLOCK_HEAD_LINE, '\n').split(PHRASE_SPLIT)) {
    const text = normalizeQuoteText(raw);
    if (text) out.push({ text, words: words(text) });
  }
  return out;
}

// Граница фраз в свёрнутом тексте: нормализация её не пропустит (знаки → пробел).
const PHRASE_JOIN = ' \u0000 ';

/**
 * DY5-2 (дейлик 2026-10-25): страж зовётся на каждый чанк потока по всему ответу,
 * и материалы хода резались на фразы, а цитаты сверялись заново каждый раз — до
 * 0,1 с на чанк. Материалы одни на ход: фразы и вердикты по цитате живут, пока
 * не сменился текст материалов. ponytail: одна запись — ход идёт по одному.
 */
let memo: { materials: string; phrases: Phrase[]; joined: string; verdicts: Map<string, number> } | null = null;
function memoFor(materials: string) {
  if (memo?.materials !== materials) {
    const phrases = phrasesOf(materials);
    memo = { materials, phrases, joined: phrases.map(p => p.text).join(PHRASE_JOIN), verdicts: new Map() };
  }
  return memo;
}
function cached(m: NonNullable<typeof memo>, key: string, f: () => number): number {
  let v = m.verdicts.get(key);
  if (v === undefined) m.verdicts.set(key, v = f());
  return v;
}

/** Наибольшее число слов цитаты, идущих по порядку внутри ОДНОЙ фразы материалов. */
function bestInPhrases(qWords: string[], phrases: Phrase[], span: number): number {
  let best = 0;
  for (const p of phrases) {
    if (p.words.length <= best) continue;
    const got = bestInOrder(qWords, p.words, span);
    if (got > best) best = got;
  }
  return best;
}

function bestInOrder(q: string[], hay: string[], span: number): number {
  if (q.length > FUZZY_MAX_WORDS) return 0;
  const qset = new Set(q);
  const qNeg = negations(q);
  let best = 0;
  for (let i = 0; i < hay.length && best < q.length; i++) {
    if (!qset.has(hay[i]!)) continue;
    const w = hay.slice(i, i + span);
    if (negations(w) !== qNeg) continue;
    let prev = new Array<number>(w.length + 1).fill(0);
    for (const qw of q) {
      const cur = new Array<number>(w.length + 1).fill(0);
      for (let j = 0; j < w.length; j++) cur[j + 1] = qw === w[j] ? prev[j]! + 1 : Math.max(prev[j + 1]!, cur[j]!);
      prev = cur;
    }
    best = Math.max(best, prev[w.length]!);
  }
  return best;
}

export function unquoteAbsent(
  text: string,
  materials: string | null | undefined,
  opts?: UnquoteOptions,
): { text: string; stripped: string[] } {
  if (!materials || !normalizeQuoteText(materials)) return { text, stripped: [] };
  const mm = memoFor(materials);
  const stripped: string[] = [];
  let out = '';
  let last = 0;
  for (const m of text.matchAll(QUOTE_SPAN_RE)) {
    const at = m.index ?? 0;
    const inner = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const window = text.slice(Math.max(0, at - 40), at).toLowerCase();
    const n = words(normalizeQuoteText(inner)).length;
    const speech = SPEECH_CUE_RE.test(window);
    if (inner.length < 1 || n < (speech ? MIN_SPEECH_WORDS : MIN_WORDS)) continue;
    const nq = normalizeQuoteText(inner);
    // DL-19 (19.3) + DY5: дословная цитата из нескольких фраз проходит, только если
    // сама держит их границы там же, где они в материалах («…почему. А если…»).
    // Склейка, где граница съедена (точка → тире, запятая), кавычки теряет.
    const nqPhrases = phrasesOf(inner).map(p => p.text).join(PHRASE_JOIN);
    if (cached(mm, `=${nqPhrases}`, () => Number(mm.joined.includes(nqPhrases)))) continue;
    // DY4 (15.1б): почти дословная — одно (от 8 слов — два) слово мимо — кавычки
    // остаются: это цитата с огрехом, а не пересказ. DL-19 (19.3): сверка идёт
    // внутри одной фразы материалов, склейка хвоста одной фразы с началом другой
    // кавычки теряет.
    const qWords = words(nq);
    const miss = n >= 8 ? 2 : n >= 4 ? 1 : 0;
    if (miss > 0 && cached(mm, `~${nq}`, () => bestInPhrases(qWords, mm.phrases, n + miss)) >= n - miss) continue;
    stripped.push(inner);
    let before = text.slice(last, at);
    let body = inner;
    // DY4 (15.1а): без глагола речи «по смыслу» — только у пересказа, то есть
    // когда больше половины слов цитаты идут в материалах по порядку. Своё
    // толкование модели от первого лица теряет кавычки без пометки — иначе оно
    // читается пересказом слов человека.
    const personal = opts?.markPersonal !== false && PERSONAL_RE.test(inner.toLowerCase())
      && cached(mm, `p${nq}`, () => bestInPhrases(qWords, mm.phrases, Math.ceil(n * 1.5) + 2)) * 5 > n * 3;
    if (SPEECH_ANY_RE.test(window) || SPEECH_AFTER_RE.test(text.slice(at + m[0].length, at + m[0].length + 40).toLowerCase()) || personal) {
      // «она сказала: «…»» → «она сказала, по смыслу: …»; в начале фразы — «По смыслу: …».
      // DE-5: перевод строки не снимаем — иначе абзац склеивался с предыдущим.
      before = before.replace(/[ \t:,]*$/, '');
      // PR-7: после тире запятая не ставится — «звучит так — по смыслу: …».
      const dashBefore = /[—–-]$/.test(before);
      const sentenceStart = /(?:^|[.!?\n])\s*$/.test(out + before);
      body = dashBefore
        ? ` по смыслу: ${inner}`
        : sentenceStart
          ? `${before && !before.endsWith('\n') ? ' ' : ''}По смыслу: ${inner}`
          : `, по смыслу: ${inner}`;
    }
    out += before + body;
    last = at + m[0].length;
  }
  return { text: out + text.slice(last), stripped };
}

/** Сколько кавычек правило сняло — счётчик для журнала, без правки текста. */
export function countAbsentQuotes(text: string, materials: string | null | undefined): number {
  return unquoteAbsent(text, materials).stripped.length;
}
