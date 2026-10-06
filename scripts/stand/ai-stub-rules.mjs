// X-7: чем именно отвечает заглушка стенда. Вынесено из ai-stub.mjs, чтобы
// ответы можно было проверить тестом без сервера: раньше заглушка на промпт
// разбора заметки отвечала эхо-строкой, summarizeDocument не мог разобрать
// ответ и отдавал 503 «Failed to parse summary». Из-за этого на стенде не
// существовало сценария «заметка → разбор → вектор → контекст чата», то есть
// всего конвейера, который правит X-1.
const sleep = (ms) => sleep0(ms);
function sleep0(ms) { return new Promise((r) => setTimeout(r, ms)); }

const lastUser = (messages) => String([...messages].reverse().find((m) => m.role === 'user')?.content ?? '').trim();
const systemOf = (messages) => String(messages.find((m) => m.role === 'system')?.content ?? '');

const MEMORY_DELAY_MS = () => Number(process.env.STAND_AI_STUB_MEMORY_MS ?? 12_000);

/** Текст заметки из промпта разбора: он заключён в маркеры USER_NOTE. */
export function noteFromBody(userContent) {
  const m = /\[USER_NOTE_START\]([\s\S]*?)\[USER_NOTE_END\]/.exec(String(userContent));
  return (m ? m[1] : String(userContent)).trim();
}

/** Первое предложение заметки — оно же дословная цитата. */
function firstSentence(text) {
  const s = String(text).split(/(?<=[.!?])\s+/).find((p) => p.trim().length > 12) ?? String(text).trim();
  return s.replace(/\s+/g, ' ').trim();
}

/** Значимые слова заметки: кириллические существительные/глаголы по длине ≥ 5. */
function keyWords(text) {
  const words = String(text).toLowerCase().match(/[а-яё]{5,}/g) ?? [];
  const stop = new Set(['который', 'очень', 'тоже', 'чтобы', 'после', 'первый', 'второй', 'кажется', 'действительно', 'действием', 'причинах', 'поэтому']);
  const seen = [];
  for (const w of words) if (!stop.has(w) && !seen.includes(w)) seen.push(w);
  return seen.slice(0, 4);
}

/**
 * Разбор заметки, проходящий схему summarizeDocument (api/ai/summarizeDocument.logic.ts):
 * обязательные поля, тон из списка промпта, кириллица в текстах (иначе поле
 * отбрасывается как нечитаемое), цитата — дословно из текста.
 */
export function noteSummaryJson(noteText) {
  const note = noteFromBody(noteText);
  const sentence = firstSentence(note);
  const words = keyWords(note);
  return JSON.stringify({
    summary: `Автор записи рассказывает о том, что происходит в тексте: ${sentence.slice(0, 120)}`,
    tone: 'задумчивый',
    frequentWords: words.length > 0 ? words : ['запись'],
    authorPhrases: words.slice(0, 2),
    insights: [`Запись стенда про: ${words.slice(0, 2).join(', ') || 'повседневное'}`],
    quotableSentence: sentence,
    themes: ['Запись стенда'],
    extractedFacts: ['Автор сделал запись на стенде'],
    commitments: [],
    valence: 0,
    arousal: 0.3,
  });
}

/** Ответ чата: эхо последнего хода + уникальный хвост. Настоящая модель на
 *  перегенерации даёт другой текст, а AIDialogueService выкидывает из вариантов
 *  повторы — с одинаковым ответом «перегенерация» не создала бы второй вариант,
 *  и стенд не мог бы проверить ни слияние вариантов, ни их перелистывание. */
let answerSeq = 0;

export function chatAnswer(messages) {
  const asked = lastUser(messages).replace(/\[(slow|memory-delay)\]/g, '').replace(/\s+/g, ' ').slice(-160);
  return `ответ заглушки на: ${asked} · ${++answerSeq}`;
}

/** Чем отвечать на non-stream вызов — по системному промпту вызывающей функции. */
export async function completionContent(messages) {
  const sys = systemOf(messages);
  if (sys.includes('Проанализируй личную заметку')) return noteSummaryJson(lastUser(messages));
  if (sys.includes('Извлеки долговременные единицы памяти')) {
    // Пустой список здесь = курсор памяти не двигается, и сценарии памяти на
    // стенде молча не проверяются. Поэтому память всегда непустая.
    const whole = lastUser(messages);
    if (whole.includes('[memory-delay]')) {
      console.warn(`[ai-stub] память: держу ответ ${MEMORY_DELAY_MS()} мс (маркер в диалоге)`);
      await sleep(MEMORY_DELAY_MS());
    }
    const asked = whole.replace(/\[CONVERSATION_(START|END)\]/g, '').replace('[memory-delay]', '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return JSON.stringify([
      { kind: 'insight', text: `Пользователь обсуждал: ${asked || 'записи стенда'}` },
      { kind: 'commitment', text: 'Пользователь собирается вернуться к этому позже' },
    ]);
  }
  if (sys.includes('придирчивый AI-Судья')) {
    return JSON.stringify({ passed: true, reason: 'заглушка стенда: убеждение принято', correctiveHint: '' });
  }
  if (sys.includes('сформулировать ОДНО устойчивое смысловое убеждение')) {
    return 'Заглушка: пользователь внимательно относится к деталям.';
  }
  return chatAnswer(messages);
}

export { sleep, lastUser, systemOf };
