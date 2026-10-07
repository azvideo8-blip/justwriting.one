// DLG-Q4 (Fable T-7 + T-19): реплика на латинице при русском архиве. Модель
// отвечает по-английски 0 раз из 6 — с подсказкой в самой реплике становится
// 6 из 6. Подсказку добавляет сервер к запросу провайдеру, в хранимый диалог
// она не попадает.

export const ENGLISH_NUDGE = '(Answer in English.)';

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
