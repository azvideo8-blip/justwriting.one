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
// S-51: блоки склеивает useAIPageData через этот разделитель; шапка внутри тела
// заметки (похожая строка в самом тексте) блока не начинает — иначе остаток
// скрытой заметки за ней уходил в модель.
export const ATTACHED_BLOCK_SEP = '\n\n---\n\n';

/**
 * Шапки блоков хода. Одна разборка на всех, кто решает «что из хода скрыто»
 * (hideExcludedNotes, ворота хода, правило хода в useAIChat — DY4): разные
 * регулярки давали разные ответы на один и тот же текст.
 */
export function attachedBlockHeads(content: string, ids?: readonly string[]): RegExpExecArray[] {
  return [...content.matchAll(ATTACHED_BLOCK_HEAD)]
    .filter(h => h.index === 0 || content.slice(h.index - ATTACHED_BLOCK_SEP.length, h.index) === ATTACHED_BLOCK_SEP)
    // Ревью безопасности 0.10.10: текст заметки вставляется в ход как есть, и
    // строка «---» + шапка внутри него неотличима от настоящего блока. Список
    // приложенных знает только сборщик хода (useAIPageData) — шапка с чужим id не блок.
    .filter(h => !ids || ids.includes(h[1]!));
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
  // Ревью безопасности 0.10.10: «---» с пустыми строками внутри текста заметки
  // неотличим от границы блока, и шапка за ним (даже с id другой приложенной
  // заметки) читалась бы отдельным видимым блоком — хвост скрытой ушёл бы в
  // модель. В ходе от сборщика разделитель стоит только между блоками.
  // Экранируется весь блок, а не тело: тело с «\n---» в начале складывало
  // разделитель на стыке с шапкой.
  return `${refHead(a)}\n${a.content}`.replace(/\n\n---(?=\n\n)/g, '\n\n- - -');
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
