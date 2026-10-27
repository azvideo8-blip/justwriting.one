// TI-1: фикстуры хода для тестов. Текущая форма собирается общим писателем;
// старые формы — только именованными функциями, чтобы «без шапки» больше не
// означало одновременно «старый ход» и «ход, куда тело не влезло».
import { attachedTurn, type AttachedNoteBlock } from '../features/ai/utils/attachedNoteFormat';
import { ATTACHED_QUESTION_SEP } from '../shared/ai/languageNudge';

export { attachedTurn };

/** До 2026-07-15 (S-51): шапки `[#id · дата]` нет — маркер, пустая строка, тело. */
export function legacyTurnNoHead({ title, body, question }: {
  title: string;
  body: string;
  question?: string;
}): string {
  return `[Прикреплена заметка: "${title}"]\n\n${body}${question ? `${ATTACHED_QUESTION_SEP}${question}` : ''}`;
}

/** S-39: в названии сырые кавычки/перевод строки; шапку узнают по началу маркера. */
export function legacyTurnQuotedTitle({ documentId, day, title, body, question }: {
  documentId: string;
  day: string;
  title: string;
  body: string;
  question?: string;
}): string {
  return `[#${documentId} · ${day}]\n[Прикреплена заметка: "${title}"]\n${body}${question ? `${ATTACHED_QUESTION_SEP}${question}` : ''}`;
}

/**
 * DY5: заметка диалога без сборщика (поднята по documentId диалога) — один блок
 * с сырым текстом; в контекст идёт под своей пометкой, как раньше шёл ход без шапок.
 */
export function linkedNote(documentId: string, content: string, title = ''): { blocks: AttachedNoteBlock[]; fromLink: true } {
  return { blocks: [{ documentId, title, content }], fromLink: true };
}
