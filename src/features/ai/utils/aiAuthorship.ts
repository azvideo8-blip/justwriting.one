// К21-5 (случай #21, 21.3): человек говорит, что приложенный текст написал не он,
// а ИИ («это от ИИ», «суммирование от ИИ», «это сводка от чата», «написал другой
// ИИ»). Без пометки модель подаёт формулировки такого текста как слова человека
// («ты писал, что…») — и разбирает чужую речь как его собственную.
//
// Оговорку ищут только в репликах человека: в теле самой заметки фраза «это от
// ИИ» может быть цитатой или темой записи, и она ничего не говорит о том, кто
// написал текст. Поэтому вопрос этого хода берётся из `text` (он отделён от тела
// заметки), а прошлые ходы — только из части после разделителя вопроса: старый
// ход с вложением на вопрос и тело не разделить, и он пропускается.
//
// `\b` в JS — только ASCII: у кириллицы границы слова нет, и «ии\b» не матчил бы
// ничего. Границы — свои, как в isProvenanceTurn.
import type { AIMessage } from '../services/AIService';
import { ATTACHED_QUESTION_SEP } from '../../../shared/ai/languageNudge';
import type { AttachedNoteBlock } from './attachedNoteFormat';

const W_END = '(?![а-яё])';
const W_START = '(?<![а-яё])';
const A_END = '(?![a-z0-9])';
const A_START = '(?<![a-z0-9])';

const fold = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

/** Кто написал текст, по словам человека. Падежи — окончанием, не перечнем форм. */
const AI_TOKEN = `(?:${W_START}ии${W_END}|нейросет[а-яё]{0,3}|${A_START}chatgpt${A_END}|${A_START}gpt${A_END}|языков[а-яё]{0,3} модел[а-яё]{0,2}|${W_START}чат[а-яё]{0,3}|${W_START}бот(?:а|у|ом|е|ы|ов|ам)?${W_END}|${W_START}ассистент[а-яё]{0,3})`;
/** Что именно написано не человеком. */
const TEXT_NOUN = '(?:это|этот|эта|эти|текст|фрагмент|кусок|цитат|сводк|суммирование|саммари|пересказ|выжимк|ответ|заметк|запис|пост|письмо|абзац|часть)';
// Только глаголы авторства: «упоминал ИИ», «говорил про чат» — о теме записи,
// а не о том, кто её написал.
const WROTE = '(?:написал|написала|написали|написано|сгенерировал|сгенерировала|сгенерировали|сгенерировано|составил|составила|составили|составлено|сделал|сделала|сделали|сделано|выдал|выдала)';
// Предлог — словом, а не куском другого слова: «ответ» содержит «от».
const PREP = `(?:^|[^а-яё])(?:от|из|со) `;

const AI_AUTHORSHIP_RES: readonly RegExp[] = [
  // «это от ИИ», «сводка от чата», «ответ из gpt»
  new RegExp(`${TEXT_NOUN}[^.!?\\n]{0,20}?${PREP}${AI_TOKEN}`),
  // «написал другой ИИ», «сгенерировано нейросетью»
  new RegExp(`${WROTE}[^.!?\\n]{0,30}?${AI_TOKEN}`),
  // «ИИ написал это», «чат выдал сводку»
  new RegExp(`${AI_TOKEN}[^.!?\\n]{0,20}?${WROTE}`),
];

/** Реплика человека говорит, что текст написан ИИ. */
export function aiAuthorshipClaim(text: string): boolean {
  const folded = fold(text);
  return AI_AUTHORSHIP_RES.some(re => re.test(folded));
}

/** Предложения реплики, в которых есть оговорка. */
function claimSentences(text: string): string[] {
  return text.split(/(?<=[.!?;])\s+|\n+/).filter(s => aiAuthorshipClaim(s));
}

/**
 * Реплики человека: вопрос этого хода и вопросы прошлых. Ход с приложенной
 * заметкой хранит тело заметки в той же строке — берётся только часть после
 * разделителя вопроса; ход без разделителя и с маркером вложения пропускается.
 */
export function humanQuestions(question: string, history: readonly AIMessage[]): string[] {
  const out: string[] = [];
  for (const m of history) {
    if (m.role !== 'user' || typeof m.content !== 'string') continue;
    const at = m.content.lastIndexOf(ATTACHED_QUESTION_SEP);
    if (at >= 0) { out.push(m.content.slice(at + ATTACHED_QUESTION_SEP.length)); continue; }
    if (m.content.includes('[Прикреплен') || m.content.includes('[Прикреплён')) continue;
    out.push(m.content);
  }
  if (question.trim()) out.push(question);
  return out;
}

/**
 * Какие заметки хода помечать. Оговорка, называющая заметку, относится к ней.
 * Оговорка ЭТОГО хода без названия — ко всем приложенным сейчас: текст человека
 * читается как оговорка про то, что он прислал.
 *
 * Ревью К21: оговорка ПРОШЛОГО хода без названия относится только к заметкам,
 * приложенным в том же ходе (маркер `[Прикреплена заметка: "…"]` перед
 * разделителем). Прежнее «ко всем приложенным сейчас» метило собственный дневник
 * человека как текст ИИ, если сводку он приложил ходом раньше.
 */
const ATTACHED_TITLE_RE = /\[Прикреплен[аоы]? заметк[аи]: "([^"]+)"\]/g;

export function aiWrittenNoteIds(
  blocks: readonly AttachedNoteBlock[],
  question: string,
  history: readonly AIMessage[],
): Set<string> {
  if (blocks.length === 0) return new Set();
  const bound = new Set<string>();
  const byTitleIn = (text: string, into: Set<string> = bound) => {
    const folded = fold(text);
    for (const b of blocks) {
      const title = fold(b.title).trim();
      if (title.length >= 4 && folded.includes(title)) into.add(b.documentId);
    }
  };
  for (const m of history) {
    if (m.role !== 'user' || typeof m.content !== 'string') continue;
    const at = m.content.lastIndexOf(ATTACHED_QUESTION_SEP);
    if (at < 0) {
      if (m.content.includes('[Прикреплен') || m.content.includes('[Прикреплён')) continue;
      for (const s of claimSentences(m.content)) byTitleIn(s);
      continue;
    }
    const claims = claimSentences(m.content.slice(at + ATTACHED_QUESTION_SEP.length));
    if (claims.length === 0) continue;
    for (const s of claims) byTitleIn(s);
    const titlesThen = [...m.content.slice(0, at).matchAll(ATTACHED_TITLE_RE)].map(x => fold(x[1] ?? '').trim());
    for (const b of blocks) if (titlesThen.includes(fold(b.title).trim())) bound.add(b.documentId);
  }
  const now = claimSentences(question);
  if (now.length > 0) {
    // Своё множество: история может уже содержать этот же вопрос, и «название не
    // нашлось» нельзя мерить по общему счётчику.
    const nowBound = new Set<string>();
    for (const s of now) byTitleIn(s, nowBound);
    for (const id of nowBound.size > 0 ? nowBound : blocks.map(b => b.documentId)) bound.add(id);
  }
  return bound;
}

/**
 * Блоки хода с пометкой. Тот же объект, если помечать нечего: оговорка бывает
 * редко, и пересобирать блоки на каждом ходе незачем.
 */
export function markAiWritten<T extends { blocks: AttachedNoteBlock[] }>(
  attached: T | null,
  question: string,
  history: readonly AIMessage[],
): T | null {
  if (!attached) return null;
  const ids = aiWrittenNoteIds(attached.blocks, question, history);
  if (ids.size === 0) return attached;
  return {
    ...attached,
    blocks: attached.blocks.map(b => (ids.has(b.documentId) ? { ...b, aiWritten: true } : b)),
  };
}
