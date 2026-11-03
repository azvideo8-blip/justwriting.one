import type { AIDialogue } from '../../../core/storage/localDb';
import type { HiddenNoteIds } from './hiddenNoteIds';
import { citesAnyId } from './aiChatTransport';

/**
 * DY6-3 (приёмка 26.10, Н-2): одно правило видимости диалога-источника для
 * продюсера граней (AIProfileFacetBuilder) и стража на чтении
 * (AIProfileFacetService.getAll). Две копии разъезжаются — урок b5446718.
 * Диалог невидим, если: его нет на устройстве или удалён; его заметка-тема
 * скрыта/в корзине; любая реплика цитирует скрытую заметку.
 */
export function dialogueFacetVisible(
  dialogue: AIDialogue | undefined,
  hiddenIds: HiddenNoteIds,
): boolean {
  if (!dialogue || dialogue.deletedAt) return false;
  return !dialogueCitesHidden(dialogue, hiddenIds);
}

/**
 * Хвост плана 27.10 (§7): «тема или реплика ведут на скрытую заметку» — одна
 * формулировка для граней (выше) и proactive-блока. Удалённость диалога сюда не
 * входит: proactive её не проверял, и строже он стал бы только с замером.
 */
export function dialogueCitesHidden(
  dialogue: Pick<AIDialogue, 'documentId' | 'messages'>,
  hiddenIds: HiddenNoteIds,
): boolean {
  if (dialogue.documentId && hiddenIds.has(dialogue.documentId)) return true;
  return dialogue.messages.some(m => citesAnyId(m.content, hiddenIds));
}
