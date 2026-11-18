import { looksLikeNoteSearch } from './aiChatTransport';

/**
 * X-1: светский ход. «Привет», «как дела», «спасибо», «...» — реплика, по которой
 * нечего искать в архиве, но до этой проверки она получала ~3 100 знаков
 * контекста: сводку последних заметок, динамику настроения, «новые/ушедшие
 * темы», открытые обязательства и три тела заметок.
 *
 * Предикат один и используется во всех трёх точках, где ход раньше тянул
 * контекст (проактивный блок, лайт-поиск, векторизация реплики) и в четвёртой
 * (фасеты профиля), где он жил своей копией.
 *
 * Консервативность: всё, что не узнали, — не светский ход.
 */

/** Пресеты-психологи: им фасеты профиля нужны и без явного поиска. */
export const PSYCHE_PERSONAS = ['group_psychology', 'cbt', 'coach', 'parts', 'ta'];

// Нормализуем ход до строчки строгих букв/цифр и пробелов: «Привет!» и
// «привет, как дела» — фразы словаря. ё → е, чтобы словарь не двоился.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const SMALL_TALK_PHRASES = new Set([
  // RU
  'привет', 'приветик', 'приветищ', 'прив', 'здравствуй', 'здравствуйте', 'здарова', 'здаров',
  'хай', 'хеллоу', 'салют', 'ку', 'ну привет',
  'доброе утро', 'добрый день', 'добрый вечер', 'доброй ночи',
  'как дела', 'как ты', 'как ты там', 'как жизнь', 'как настроение', 'как сам', 'что нового', 'что как',
  'расскажи о себе', 'что ты умеешь', 'кто ты', 'ты кто', 'ты тут', 'ты на связи', 'ты здесь',
  'спасибо', 'спасибо большое', 'спасибки', 'спс', 'пасиб', 'благодарю', 'благодарю тебя', 'большое спасибо',
  'хорошо', 'ладно', 'окей', 'ок', 'ага', 'угу', 'да', 'нет',
  'пока', 'до свидания', 'всего доброго', 'до встречи', 'спокойной ночи',
  // EN
  'hi', 'hello', 'hey', 'hai', 'yo', 'hiya', 'howdy', 'hello there',
  'good morning', 'good afternoon', 'good evening',
  'how are you', 'how are you doing', 'how is it going', 'hows it going', 'what s up', 'sup',
  'how do you do', 'nice to meet you',
  'thanks', 'thank you', 'thank you so much', 'thanks a lot', 'many thanks',
  'ok', 'okay', 'all right', 'alright', 'yes', 'no', 'bye', 'goodbye', 'see you',
  'who are you', 'what can you do', 'tell me about yourself', 'are you there',
]);

const MAX_PHRASE_WORDS = 4;

/** Ход целиком собран из фраз словаря: «привет», «привет как дела», «ок спасибо пока». */
function isComposedOfPhrases(words: string[]): boolean {
  // ok[i] — первые i слов покрыты фразами словаря.
  const ok = [true];
  for (let i = 1; i <= words.length; i++) {
    ok[i] = false;
    for (let n = 1; n <= Math.min(MAX_PHRASE_WORDS, i) && !ok[i]; n++) {
      ok[i] = Boolean(ok[i - n]) && SMALL_TALK_PHRASES.has(words.slice(i - n, i).join(' '));
    }
  }
  return Boolean(ok[words.length]);
}

/**
 * Светский ли это ход. Только словарь: короткий ход вне словаря («мама умерла»,
 * «нет сил», «грусть», «😢») — не светский, сколько бы в нём ни было слов.
 * Порог длины давал именно этим ходам пустой контекст.
 */
export function isSmallTalkTurn(text: string): boolean {
  // Эмодзи — не пустой ход: «😢» говорит о состоянии. Приветственные — нейтральны.
  if (/\p{Extended_Pictographic}/u.test(text.replace(/[👋🙂😊🤗]/gu, ''))) return false;
  const normalized = normalize(text);
  // Пустой ход («», «...», «—») искать в архиве не по чему.
  if (!normalized) return true;
  // Вопрос — не светский ход, какой бы короткой ни была реплика.
  if (/[?]/.test(text)) return false;
  // Любая заявка на поиск по архиву («вспомни», «про Сашу», «заметк…») — не светский.
  if (looksLikeNoteSearch(text)) return false;
  return isComposedOfPhrases(normalized.split(' '));
}
