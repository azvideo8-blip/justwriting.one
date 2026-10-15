/**
 * MD-3 (0.9.38): кавычка — только для дословного.
 *
 * Модель ставит кавычки вокруг пересказа, гипотезы и склейки из двух мест:
 * на стенде arch-2026-10-11 это S5 — 19 провалов из 24 на v4-flash и 7 из 12 на
 * v4.1-flash, плюс живые находки 1.5, 2.1, 5.5, 6.1. Правило в промпте есть с
 * 0.9.35; два шага и более строгие промпты чисел не сдвинули. Значит — код после
 * ответа: цитата, которой нет в материалах хода, теряет кавычки. Слова остаются,
 * приставка «примерно:» не добавляется.
 *
 * Сверка — по свёрнутому тексту (как `squash()` стенда): регистр, ё/е, любые
 * виды кавычек, пунктуация и пробелы. Урок R-1: цитата, которая в материалах
 * есть, обязана пережить правку при любом оформлении и переносе строк.
 *
 * Кавычки в 1–3 слова не трогаются: это метки и термины, а не речь человека.
 * Исключение (находки 10.6, 11.3): короткая цитата, поданная как слова человека
 * («ты пишешь «…»», «называешь это «…»»), сверяется так же, как длинная.
 */

// Кавычки любых видов (включая „немецкие“ и одиночные) при сверке не считаются.
const QUOTE_CHARS = /[«»„“”"'‘’`]/g;

/** Три формы кавычек одной реплики; вложенность «…» внутри «…» допускается. */
const QUOTE_SPAN_RE = /«((?:[^«»]|«[^«»]*»)*)»|“((?:[^“”]|“[^“”]*”)*)”|"([^"\n]{1,400})"/g;

const MIN_WORDS = 4;
const MIN_SPEECH_WORDS = 2;

// Перед короткой цитатой — глагол речи о человеке: «пишешь», «сказала»,
// «называешь», «твоими словами». Целым словом: «разговор» — не «говоришь».
// Окно в 40 знаков до открывающей кавычки.
const SPEECH_CUE_RE = /(?:^|[^а-яё])(?:пишешь|написала?|писала?|говоришь|сказала?|называешь|назвала?|формулируешь|твоими словами|твои слова)[^.!?«»“”"\n]{0,40}$/;

/** Текст для сверки: регистр, ё/е, кавычки, пунктуация и пробелы свёрнуты. */
export function normalizeQuoteText(s: string): string {
  return s
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
export function unquoteAbsent(text: string, materials: string | null | undefined): { text: string; stripped: string[] } {
  const hay = normalizeQuoteText(materials ?? '');
  if (!hay) return { text, stripped: [] };
  const stripped: string[] = [];
  const out = text.replace(QUOTE_SPAN_RE, (match: string, guillemet: string | undefined, curly: string | undefined, straight: string | undefined, at: number) => {
    const inner = (guillemet ?? curly ?? straight ?? '').trim();
    const n = words(normalizeQuoteText(inner)).length;
    const speech = SPEECH_CUE_RE.test(text.slice(Math.max(0, at - 40), at).toLowerCase());
    if (inner.length < 1 || n < (speech ? MIN_SPEECH_WORDS : MIN_WORDS)) return match;
    if (hay.includes(normalizeQuoteText(inner))) return match;
    stripped.push(inner);
    return inner;
  });
  return { text: out, stripped };
}

/** Сколько кавычек правило сняло — счётчик для журнала, без правки текста. */
export function countAbsentQuotes(text: string, materials: string | null | undefined): number {
  return unquoteAbsent(text, materials).stripped.length;
}
