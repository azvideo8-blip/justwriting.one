/**
 * MD-2 (0.9.37): сигналы на сервере, которых прод не видел. С 0.9.38 (MD-3) к
 * ним добавился счётчик снятых кавычек — по тому же правилу, что чистит ответ на
 * клиенте (`quoteGuard`).
 *
 * Класс невидим: модель отвечает «заметка — только заголовок» или «ничего не
 * нашлось», хотя текст заметки лежит в последней ограде данных, а результатов
 * поиска — два; или цитирует номер, которого в материалах нет (`[#5742]`).
 * На стенде arch-2026-10-11 это 5 провалов из 48 на v4-flash плюс 2 ответа с
 * выдуманными ссылками; на v4.1-flash — 0 из 24. На проде частота неизвестна,
 * потому что считать её было нечем: `[chat-end]` знает только причину конца
 * хода. Здесь — счётчики на строку журнала, ни одного вызова модели и ни одного
 * символа ответа или документа в результате.
 *
 * Формы перенесены из автопроверок стенда (`check.py`: `NO_TEXT_RE`,
 * `FAKE_ID_RE`), сравнение — по свёрнутому тексту (регистр, ё/е), как там же.
 * Верхний регистр формы «ЕЁ ТЕКСТ НЕ ПРИЛОЖЕН» в стенде мёртв: проверка смотрит
 * уже свёрнутый ответ. Здесь она живая и строчная.
 */

import { countAbsentQuotes } from './quoteGuard';
import { ANSWER_REF_RE, RESULTS_FOUND_RE, RESULTS_HEAD_RE, notesClaimWithoutRef } from './notesRefRule';

const fold = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

/** Ответ утверждает, что текста заметки нет / в ней только заголовок. */
const NO_TEXT_RE = new RegExp(
  '(?:заголовок без текста|без текста|нет текста|текст не приложен'
  + '|текста (?:заметки |самой заметки )?(?:нет|не вижу|у меня нет|не приложен)'
  + '|нет (?:ни )?содержани'
  + '|(?:подробностей|деталей)(?: и даты)? в (?:самой )?заметке нет'
  + '|приложи(?:те)? (?:заметку|текст)'
  + '|не вижу (?:текста|содержания)'
  + '|только (?:название|заголовок)|одно (?:название|заголовок))',
);

/** Ответ утверждает, что поиск ничего не нашёл. */
const EMPTY_CLAIM_RE = new RegExp(
  '(?:ничего не нашлось|ничего дополнительного (?:об этом )?не нашёл'
  + '|не нашёл(?:ось)? (?:ни одной|подходящ|записей))',
);

// Три формы приложенной заметки в `documentContent`: метка строгого хода,
// «заметка диалога» (sticky) и маркер хранящегося хода `Прикреплена заметка: "…"`.
const ATTACHED_NOTE_RE = /\[(?:Прикреплен(?:ная|а) заметка|Заметка, к которой привязан этот диалог)/;

// Блок результатов поиска, его непустота и ссылка ответа (`[#id]`) описаны в
// notesRefRule — том же модуле, по которому клиент рисует пометку «нет ссылок на
// записи» (К21-4). Формы обязаны быть одни на сервер и клиент.

export interface AnswerAudit {
  note_text_denied: boolean;
  empty_claim_with_results: boolean;
  foreign_ids: number;
  /** MD-3: сколько кавычек клиент снимет как отсутствующие в материалах. */
  quote_unquoted: number;
  /**
   * К21-4: ответ пересказывает найденные записи, но не ссылается ни на одну —
   * 1, иначе 0. Тот же признак рисует пометку под ответом на клиенте.
   */
  notes_claim_no_ref: number;
  /**
   * AG-1 (12.11): предложения со ссылкой [#id], у которых меньше 30 % значимых слов
   * есть в показанном тексте этой заметки, — кандидаты в выдумку без кавычек.
   * Только счёт: удалять или нет — по частоте на проде.
   */
  weak_ref: number;
  /**
   * AG-2 (12.11): даты «D месяца» в предложении со ссылкой, которые не совпадают с
   * датой шапки этой заметки (±2 дня) и не встречаются в её тексте.
   */
  date_off_header: number;
  /**
   * К23-2 (шаг 1): сколько ответов подряд, включая этот, кончаются вопросом.
   * 0 — этот ответ вопросом не кончается. Порог строки «подведи итог» — по замеру.
   */
  question_run: number;
  /** К23-5: последний вопрос ответа — выбор «A или B» без выхода; 1, иначе 0. */
  either_or_end: number;
}

// Ревью 0.11.13: «…? [#id]» — тоже вопрос в конце; ссылки после него не считаются.
const ENDS_WITH_QUESTION_RE = /\?[\s»")]*(?:\[#[^\]]+\][\s.]*)*$/;
// Выход из выбора: «или что-то другое», «или иначе», «или ни то ни другое»…
const CHOICE_EXIT_RE = /или\s+(?:(?:про|о|об|в|на|с|к)\s+)?(?:что-то|как-то|нечто|ни то|и то|по-другому|иначе|еще|вообще)|а может/;

function questionRun(answer: string, priorAssistant: readonly string[]): number {
  if (!ENDS_WITH_QUESTION_RE.test(answer.trim())) return 0;
  let run = 1;
  for (let i = priorAssistant.length - 1; i >= 0 && ENDS_WITH_QUESTION_RE.test((priorAssistant[i] ?? '').trim()); i--) run++;
  return run;
}

function eitherOrEnd(answer: string): number {
  const last = answer.trim().split(/(?<=[.!?…])\s+/).filter(s => ENDS_WITH_QUESTION_RE.test(s)).pop();
  if (!last) return 0;
  const q = fold(last);
  return /\sили\s/.test(q) && !CHOICE_EXIT_RE.test(q) ? 1 : 0;
}

const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const RU_DATE_RE = /(?<![\d])(\d{1,2})\s+(январ[ья]|феврал[ья]|марта?|апрел[ья]|ма[яй]|июн[ья]|июл[ья]|августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])/gi;
const HEADER_RE = /\[#([^\s·\]]+) · (\d{4})-?(\d{2})-?(\d{2})\]/g;

/** Показанный текст каждой заметки хода: от шапки «[#id · дата]» до следующей шапки. */
function notesOf(doc: string): Map<string, { text: string; month: number; day: number }> {
  const out = new Map<string, { text: string; month: number; day: number }>();
  const heads = [...doc.matchAll(HEADER_RE)];
  heads.forEach((m, i) => {
    const id = m[1] ?? '';
    const start = (m.index ?? 0) + m[0].length;
    const end = heads[i + 1]?.index ?? doc.length;
    const prev = out.get(id);
    out.set(id, { text: `${prev?.text ?? ''}\n${doc.slice(start, end)}`, month: Number(m[3]), day: Number(m[4]) });
  });
  return out;
}

const stemsOf = (s: string): string[] => (fold(s).match(/[а-яa-z]{5,}/g) ?? []).map(w => w.slice(0, 5));

function groundingCounts(answer: string, doc: string): { weak_ref: number; date_off_header: number } {
  const notes = notesOf(doc);
  let weak = 0;
  let offDate = 0;
  if (notes.size === 0) return { weak_ref: 0, date_off_header: 0 };
  for (const sentence of answer.split(/(?<=[.!?…])\s+/)) {
    const ids = [...sentence.matchAll(ANSWER_REF_RE)].map(m => m[1] ?? '').filter(id => notes.has(id));
    if (ids.length === 0) continue;
    const shown = ids.map(id => notes.get(id)!);
    const hay = fold(shown.map(n => n.text).join('\n'));
    const stems = stemsOf(sentence.replace(ANSWER_REF_RE, ''));
    if (stems.length >= 4 && stems.filter(st => hay.includes(st)).length / stems.length < 0.3) weak++;
    for (const d of sentence.matchAll(RU_DATE_RE)) {
      const day = Number(d[1]);
      const month = MONTHS.findIndex(p => fold(d[2] ?? '').startsWith(p)) + 1;
      const near = shown.some(n => n.month === month && Math.abs(n.day - day) <= 2);
      const inText = hay.includes(fold(d[0]));
      if (!near && !inText) offDate++;
    }
  }
  return { weak_ref: weak, date_off_header: offDate };
}

/**
 * Аудит ответа против материалов хода. `null`, если материалов не было вовсе:
 * без них утверждать нечего, и строка журнала остаётся в прежнем составе.
 *
 * `quoteMaterials` — чем клиент сверяет цитаты (ограда данных + память + реплики
 * человека этого хода, то же собрание, что `materialsText` в `useAIChat`). Без
 * него считается по одному `documentContent` — тогда число нижняя граница: часть
 * цитат живёт в памяти и в репликах.
 */
export function auditAnswer(
  answer: string,
  documentContent: string | null | undefined,
  quoteMaterials?: string | null | undefined,
  /** К23-2: прошлые ответы ассистента этого диалога, по порядку. */
  priorAssistant: readonly string[] = [],
): AnswerAudit | null {
  const doc = documentContent ?? '';
  if (!doc.trim() || !answer.trim()) return null;
  const low = fold(answer);
  const refs = new Set<string>();
  for (const m of answer.matchAll(ANSWER_REF_RE)) {
    const id = m[1] ?? '';
    if (id && !doc.includes(id)) refs.add(id);
  }
  return {
    note_text_denied: ATTACHED_NOTE_RE.test(doc) && NO_TEXT_RE.test(low),
    empty_claim_with_results: RESULTS_HEAD_RE.test(doc) && RESULTS_FOUND_RE.test(doc) && EMPTY_CLAIM_RE.test(low),
    foreign_ids: refs.size,
    quote_unquoted: countAbsentQuotes(answer, quoteMaterials ?? doc),
    notes_claim_no_ref: notesClaimWithoutRef(answer, doc) ? 1 : 0,
    ...groundingCounts(answer, doc),
    question_run: questionRun(answer, priorAssistant),
    either_or_end: eitherOrEnd(answer),
  };
}
