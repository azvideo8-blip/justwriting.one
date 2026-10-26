// TI-1: единственный писатель хода с приложенной заметкой. Им пользуются и
// useAIPageData, и тесты — чтобы форма хода больше не расходилась по файлам.
import { localDayKey } from '../../../core/utils/dateUtils';
import { ATTACHED_QUESTION_SEP } from '../../../shared/ai/languageNudge';
import { cleanAttachedTitle } from './aiChatTransport';

// S-39: блок каждой приложенной заметки начинается шапкой `[#id · дата]` +
// маркер (см. useAIPageData; у старых ходов в названии бывают кавычки и
// переводы строк — маркер читаем до первого `"]` в конце строки). Тело заметки,
// скрытой от ИИ, вырезаем перед отправкой; ошибка чтения документа читается
// как «скрыта», а не как «можно».
const ATTACHED_BLOCK_HEAD = /^\[#([^\s\]·]+) · [^\]\n]*\]\n\[Прикреплена заметка: "[\s\S]*?"\]\n/gm;
// Шапка от сборщика: название без переводов строк (cleanAttachedTitle), маркер —
// одна строка. Ревью безопасности DY5-1: маркер «до первого `"]`» в теле заметки
// тянулся через строки и глотал настоящую шапку следующей заметки, а поддельная
// шапка рядом возвращала счёт — сверка со списком проходила.
const BUILDER_BLOCK_HEAD = /^\[#([^\s\]·]+) · [^\]\n]*\]\n\[Прикреплена заметка: "[^\n]*"\]\n/gm;
// S-51: блоки склеивает useAIPageData через этот разделитель; шапка внутри тела
// заметки (похожая строка в самом тексте) блока не начинает — иначе остаток
// скрытой заметки за ней уходил в модель.
export const ATTACHED_BLOCK_SEP = '\n\n---\n\n';

/**
 * Шапки блоков хода. Одна разборка на всех, кто решает «что из хода скрыто»
 * (hideExcludedNotes, ворота хода, правило хода в useAIChat — DY4): разные
 * регулярки давали разные ответы на один и тот же текст.
 */
function anchoredHeads(content: string, re: RegExp): RegExpExecArray[] {
  return [...content.matchAll(re)]
    .filter(h => h.index === 0 || content.slice(h.index - ATTACHED_BLOCK_SEP.length, h.index) === ATTACHED_BLOCK_SEP);
}

export function attachedBlockHeads(content: string, ids?: readonly string[]): RegExpExecArray[] {
  if (!ids) return anchoredHeads(content, ATTACHED_BLOCK_HEAD);
  const heads = anchoredHeads(content, BUILDER_BLOCK_HEAD);
  // Ревью безопасности 0.10.10 + DY5-1: текст заметки вставляется в ход как есть,
  // и «---» + шапка внутри него неотличимы от настоящего блока. Список приложенных
  // знает только сборщик хода (useAIPageData): шапки обязаны совпасть с ним по
  // порядку и числу, иначе ход не разобран ([] — вызывающие скрывают его целиком).
  // Раньше «---» в теле экранировался, и человек видел в карточке и выгрузке не свой текст.
  return heads.length === ids.length && heads[0]?.index === 0 && heads.every((h, i) => h[1] === ids[i]) ? heads : [];
}

/**
 * Шапки хода, уже сверенного attachedBlockHeads со списком и прошедшего
 * hideExcludedNotes: остаются шапки видимых, читаются той же однострочной
 * регуляркой — прежняя глотала бы шапку за незакрытым маркером в теле.
 */
export function builderBlockHeads(content: string): RegExpExecArray[] {
  return anchoredHeads(content, BUILDER_BLOCK_HEAD);
}

/** Название из маркера шапки (`[Прикреплена заметка: "…"]`). */
export function blockHeadTitle(head: RegExpExecArray): string {
  const marker = head[0].slice(head[0].indexOf('\n') + 1);
  return marker.slice(marker.indexOf(': "') + 3, marker.lastIndexOf('"]'));
}

export interface AttachedNoteBlock {
  documentId: string;
  lastSessionAt?: number | undefined;
  title: string;
  /** Нет тела — ход «не влез»: остаётся только шапка с названием и датой. */
  content?: string | undefined;
}

type FullBlock = AttachedNoteBlock & { content: string };

export function refHead(a: Pick<AttachedNoteBlock, 'documentId' | 'lastSessionAt' | 'title'>): string {
  const yyyymmdd = localDayKey(a.lastSessionAt ?? Date.now());
  return `[#${a.documentId} · ${yyyymmdd}]\n[Прикреплена заметка: "${cleanAttachedTitle(a.title)}"]`;
}

export function formatRefTag(a: FullBlock): string {
  return `${refHead(a)}\n${a.content}`;
}

/**
 * Ход целиком: блоки с телами склеиваются через `\n\n---\n\n`, а если тела не
 * влезли — все блоки идут шапками через перевод строки. Вопрос — после
 * `ATTACHED_QUESTION_SEP`, отдельно от текста заметок.
 */
export function attachedTurn(blocks: AttachedNoteBlock[], question?: string): string {
  const full = blocks.filter((b): b is FullBlock => b.content !== undefined);
  const body = full.length === blocks.length
    ? full.map(formatRefTag).join(ATTACHED_BLOCK_SEP)
    : blocks.map(refHead).join('\n');
  return `${body}${question ? `${ATTACHED_QUESTION_SEP}${question}` : ''}`;
}
