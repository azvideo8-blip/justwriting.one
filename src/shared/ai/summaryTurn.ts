/**
 * К23-2 шаг 2 / К25-2 (случаи #23 и #25): итог после серии ответов-вопросов.
 *
 * Правило об итоге в REFLECTION_GUIDE есть, но без признака «когда»: в живых
 * диалогах по 7–8 ответов подряд кончаются вопросом, итога нет ни одного
 * (счётчик `question_run` в `[chat-end]`, прод 12–18.11). Признак ставит код:
 * от трёх ответов-вопросов подряд, а человек в своей реплике ничего не спросил
 * и ни о чём не попросил, — строка хода «подведи итог». После хода с итогом
 * серия считается заново. Образца фразы в строке нет: модель копирует образцы.
 */
export const SUMMARY_AFTER_QUESTIONS = 3;

// Тот же признак «ответ кончается вопросом», что у счётчика (answerAudit.ts).
const ENDS_WITH_QUESTION_RE = /\?[\s»")]*(?:\[#[^\]]+\][\s.]*)*$/;
const B = '(?:^|[^а-яё])';
const E = '(?![а-яё])';
// Человек сам спросил или попросил — на это отвечают, итог подождёт.
const ASK_RE = new RegExp(`\\?|${B}(?:посоветуй|подскажи|помоги|объясни|расскажи|скажи|напомни|найди|покажи|составь|напиши|разбери|предложи|что делать|как быть|как мне)[а-яё]*${E}`, 'i');

interface Msg { role: string; content: string }

export function summaryTurnDue(messages: readonly Msg[] | null | undefined): boolean {
  if (!messages || messages.length === 0) return false;
  if (messages[messages.length - 1]?.role !== 'user') return false;
  let run = 0;
  let due = false;
  for (const m of messages) {
    if (m.role === 'assistant') {
      // Ход с итогом обнуляет серию, даже если сам итог кончается вопросом «верно?».
      run = due ? 0 : (ENDS_WITH_QUESTION_RE.test(m.content.trim()) ? run + 1 : 0);
      due = false;
      continue;
    }
    if (m.role !== 'user') continue;
    due = run >= SUMMARY_AFTER_QUESTIONS && !ASK_RE.test(m.content.toLowerCase());
  }
  return due;
}

export const SUMMARY_TURN_LINE = 'ЭТОТ ХОД — ИТОГ: несколько ответов подряд кончались вопросом. Сейчас не задавай нового вопроса о сути и не давай новых толкований. Коротко собери, к чему вы пришли в этом разговоре, словами самого человека — что он заметил, понял или решил. Спроси, верно ли собрано, и предложи на выбор: продолжить или остановиться на этом.';
