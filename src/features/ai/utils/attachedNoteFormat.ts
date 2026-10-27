// TI-1: единственный писатель хода с приложенной заметкой. Им пользуются и
// useAIPageData, и тесты — чтобы форма хода больше не расходилась по файлам.
import { localDayKey } from '../../../core/utils/dateUtils';
import { ATTACHED_QUESTION_SEP } from '../../../shared/ai/languageNudge';
import { cleanAttachedTitle } from './aiChatTransport';

// S-51: блоки склеивает attachedTurn / hideExcludedNotes через этот разделитель.
// DY5: сам ход больше не разбирается на блоки — список заметок едет данными.
export const ATTACHED_BLOCK_SEP = '\n\n---\n\n';

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
