// DI-4: вывод собеседника, с которым человек согласился, идёт в «Выводы из
// разговоров» отдельным путём, мимо обычного извлечения памяти. Проверки — от
// дешёвых к дорогим: правила по тексту, затем флаг сервера, затем модель.
// Любой отказ — ничего не пишем и не показываем (отказ назван не бывает).
import { confirmationOf, codeConclusion } from '../../../shared/ai/insightConfirm';
import { HYPOTHESIS_PERSONAS } from '../../../shared/ai/hypothesisRule';
import { detectRisk } from '../utils/riskDetect';
import { getChatExtrasEnabled } from '../../../core/ai/chatExtrasPreference';
import { chatInsightsEnabled } from '../../../core/sync/syncFlags';
import { AIService } from './AIService';
import { AIChatMemoryService } from './AIChatMemoryService';
import { AIDialogueService } from './AIDialogueService';
import { extractCitationIds } from './chatContext/citations';
import type { ExcludableDoc } from '../utils/isExcludedFromAI';
import { citesAnyId, HIDDEN_ANSWER_PLACEHOLDER, toApiContent, type AttachedParseOptions } from '../utils/aiChatTransport';
import type { HiddenNoteIds } from '../utils/hiddenNoteIds';
import { reportError } from '../../../shared/errors/reportError';

export type CaptureOutcome = 'saved' | 'duplicate' | 'none' | 'failed';

export interface CaptureDoc extends ExcludableDoc {
  id: string;
  uuid?: string | undefined;
}

/**
 * Источники вывода — все заметки, на которые ссылаются ответ и прошлая реплика
 * (её маркер = приложенная заметка), по uuid. Скрытые не выкидываются: пустой
 * список значит «все источники видимы», и вывод о заметке, скрытой позже,
 * вспоминался бы дальше (ревью 0.11.24, I-1/I-2).
 */
export function insightSources(contents: string[], docs: CaptureDoc[]): string[] {
  const byId = new Map(docs.map(d => [d.id, d]));
  return [...new Set(contents.flatMap(c => extractCitationIds(c)))]
    .map(id => byId.get(id))
    .filter((d): d is CaptureDoc => !!d)
    .map(d => d.uuid ?? d.id);
}

export async function captureConfirmedInsight(input: {
  uid: string | undefined;
  dialogueId: string;
  personaId: string;
  userText: string;
  prevAssistant: { id: string; content: string; type?: 'chat' | 'system' | undefined } | null;
  /** Сырая реплика человека: тело приложенной заметки режет toApiContent ниже. */
  prevUser: string;
  hiddenCiteIds: HiddenNoteIds;
  /** Тот же разбор, что у истории хода (скрытые названия, старые ходы без шапки). */
  parseOpts: AttachedParseOptions;
  docs: CaptureDoc[];
  t: (key: string, params?: Record<string, string | number>) => string;
}): Promise<CaptureOutcome> {
  try {
    const { uid, dialogueId, personaId, userText, prevAssistant, prevUser, hiddenCiteIds, parseOpts, docs, t } = input;
    // 1. Ответ собеседника есть, не служебная строка и не о скрытой заметке.
    if (!prevAssistant || prevAssistant.type === 'system') return 'none';
    if (prevAssistant.content === HIDDEN_ANSWER_PLACEHOLDER || citesAnyId(prevAssistant.content, hiddenCiteIds)) return 'none';
    // Прошлая реплика с приложенной скрытой заметкой — тоже не место для вывода.
    if (citesAnyId(prevUser, hiddenCiteIds)) return 'none';
    // Модели и в память — реплика без тела приложенной заметки, как в истории хода.
    const prevUserApi = prevUser ? toApiContent(prevUser, undefined, parseOpts) : '';
    // 2. Только персоны с гипотезами: у редактора выводов о человеке нет.
    if (!HYPOTHESIS_PERSONAS.includes(personaId)) return 'none';
    // 3. Кризисная реплика — не место для выводов.
    if (detectRisk(userText).isRisk) return 'none';
    // 4. Служебные запросы ИИ выключены в настройках.
    if (!getChatExtrasEnabled(uid)) return 'none';
    // 5. Человек действительно согласился (правило DI-1, без модели).
    if (confirmationOf(userText, prevAssistant.content) === null) return 'none';
    // 6. Флаг сервера: по умолчанию выключен — ход как в 0.11.22.
    if (!(await chatInsightsEnabled(uid))) return 'none';
    // 7. Фраза: абзац «Если коротко:» — кодом, без модели; иначе служебный вызов.
    let quote = codeConclusion(prevAssistant.content);
    if (quote === null) {
      const picked = await AIService.pickInsight(prevUserApi, toApiContent(prevAssistant.content));
      if (!picked.ok) return 'failed';
      quote = picked.quote;
    }
    if (quote === null) return 'none';
    // 8. Источники — заметки ответа и приложенные к реплике, по uuid.
    const sourceDocumentIds = insightSources([prevAssistant.content, prevUser], docs);
    // 9. Запись с подтверждением репликой.
    const res = await AIChatMemoryService.addConclusion({
      text: quote,
      context: prevUserApi,
      dialogueId,
      messageId: prevAssistant.id,
      sourceDocumentIds,
      confirmedBy: 'reply',
    });
    if (res === 'failed') return 'failed';
    // 10. Сохранено — служебная строка в диалоге, один раз.
    if (res === 'saved') {
      await AIDialogueService.appendSystemMessage(dialogueId, t('ai_insight_saved_notice', { phrase: quote }), { once: true });
    }
    return res;
  } catch (e: unknown) {
    reportError(e, { action: 'insight_capture' }, 'warning');
    return 'failed';
  }
}