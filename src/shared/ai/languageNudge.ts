// DLG-Q4 (Fable T-7 + T-19): реплика на латинице при русском архиве. Модель
// отвечает по-английски 0 раз из 6 — с подсказкой в самой реплике становится
// 6 из 6. Подсказку добавляет сервер к запросу провайдеру, в хранимый диалог
// она не попадает.

export const ENGLISH_NUDGE = '(Answer in English.)';

// Разделитель «прикреплённая заметка ↔ вопрос». Один источник на клиента
// (useAIPageData собирает ход, aiChatTransport разбирает) и на сервер (здесь
// решает язык). Буква-копия в четвёртом месте уже разъезжалась с остальными.
export const ATTACHED_QUESTION_SEP = '\n\n— — —\nВопрос: ';

// Маркер прикреплённой заметки строкой целиком (ту же форму узнаёт
// aiChatTransport и ATTACHED_NOTE_MARKER в aiPolicy).
const ATTACHED_MARKER_LINE = /^\[Прикреплена заметка: "[\s\S]*?"\][^\n]*\n?/gm;

/**
 * W-6: часть реплики, по которой судят о языке — сам вопрос.
 *
 * Ход с вложением доходит до сервера одним текстом: маркер заметки, её тело и
 * после разделителя вопрос. И маркер, и тело — кириллица, поэтому решение о
 * языке по всему тексту превращало английский вопрос про русскую заметку в
 * русский ответ.
 */
export function questionPart(text: string): string {
  const at = text.lastIndexOf(ATTACHED_QUESTION_SEP);
  const part = at >= 0
    ? text.slice(at + ATTACHED_QUESTION_SEP.length)
    : text.replace(ATTACHED_MARKER_LINE, '');
  // Пустой вопрос («только заметка, спрашивать не о чём») не решает язык —
  // возвращаем исходный текст, язык остаётся за его содержимым.
  return part.trim().length === 0 ? text : part;
}

// Транслит: русские слова, набранные латиницей. Границы `\b` здесь работают —
// слова чисто ASCII (в кириллических паттернах по всему проекту `\b` мёртв).
const TRANSLIT = /\b(kak|privet|chto|net|da|ya|ne|dela|spasibo|poka|nado|mne|tebe)\b/i;

/**
 * Нужна ли подсказка «отвечай по-английски». Ровно прототип run.mjs:43–51:
 * ссылки и код вырезаются (они не про язык человека), кириллица в остатке —
 * русский, меньше трёх латинских слов — слишком мало доказательств, транслит —
 * это русский буквами английского алфавита.
 */
export function needsEnglishNudge(text: string): boolean {
  const stripped = text.replace(/https?:\/\/\S+/g, ' ').replace(/`[^`]*`/g, ' ');
  if (/[А-Яа-яЁё]/.test(stripped)) return false;
  const words = stripped.match(/[A-Za-z]{2,}/g) ?? [];
  if (words.length < 3) return false;
  if (TRANSLIT.test(stripped)) return false;
  return true;
}
