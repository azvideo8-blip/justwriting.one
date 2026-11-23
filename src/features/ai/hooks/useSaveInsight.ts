// DI-5: «Сохранить вывод» — явное подтверждение кнопкой, без догадок правила
// DI-1. Итог ведёт useServiceAction: зелёный тост только после 'saved',
// счётчик rawSuccessToasts этого файла не растёт. Занятость — busy, второй
// клик не шлёт второй запрос (защита execute от параллельного вызова).
import { useState, useEffect, useCallback } from 'react';
import { getLocalDb, type AIDialogue } from '../../../core/storage/localDb';
import { getCurrentUser } from '../../../core/auth';
import { chatInsightsEnabled } from '../../../core/sync/syncFlags';
import { HYPOTHESIS_PERSONAS } from '../../../shared/ai/hypothesisRule';
import { codeConclusion } from '../../../shared/ai/insightConfirm';
import { AIService } from '../services/AIService';
import { AIChatMemoryService } from '../services/AIChatMemoryService';
import { insightSources } from '../services/insightCapture';
import { citesAnyId, HIDDEN_ANSWER_PLACEHOLDER, legacyNoteHidden, toApiContent } from '../utils/aiChatTransport';
import { hiddenNoteIdsFromDocs } from '../utils/hiddenNoteIds';
import { useServiceAction } from '../../../shared/hooks/useServiceAction';
import { useToast } from '../../../shared/components/Toast';
import { useLanguage } from '../../../shared/i18n';

export function useSaveInsight(dialogue: AIDialogue | null) {
  const { execute, isLoading } = useServiceAction();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const [flagOn, setFlagOn] = useState(false);

  // Флаг читаем один раз при открытии страницы, не на каждый ход.
  useEffect(() => {
    let active = true;
    void chatInsightsEnabled(getCurrentUser()?.uid).then(on => { if (active) setFlagOn(on); });
    return () => { active = false; };
  }, []);

  const handleSaveInsight = useCallback((messageIndex: number) => {
    void execute(async () => {
      const msgs = dialogue?.messages ?? [];
      const reply = msgs[messageIndex];
      if (!dialogue || !reply || reply.role !== 'assistant' || reply.type === 'system') {
        throw new Error('insight: no reply at index');
      }
      const prevUser = [...msgs.slice(0, messageIndex)].reverse().find(m => m.role === 'user' && m.type !== 'system');
      // AP-2 и I-1/I-2 ревью 0.11.24: ответ о скрытой заметке или реплика с ней
      // не уходят модели; реплика — без тела приложенной заметки, как в истории хода.
      const db = await getLocalDb();
      const docs = await db.getAll('documents');
      const hidden = hiddenNoteIdsFromDocs(docs);
      if (reply.content === HIDDEN_ANSWER_PLACEHOLDER || citesAnyId(reply.content, hidden)) return 'none' as const;
      if (prevUser && citesAnyId(prevUser.content, hidden)) return 'none' as const;
      const parseOpts = { legacyNoteHidden: await legacyNoteHidden(dialogue, db), hiddenCitationIds: hidden };
      const prevUserApi = prevUser ? toApiContent(prevUser.content, undefined, parseOpts) : '';
      let quote = codeConclusion(reply.content);
      if (quote === null) {
        const picked = await AIService.pickInsight(prevUserApi, toApiContent(reply.content));
        if (!picked.ok) throw new Error(picked.error);
        quote = picked.quote;
      }
      if (quote === null) return 'none' as const;
      const sourceDocumentIds = insightSources([reply.content, prevUser?.content ?? ''], docs);
      const res = await AIChatMemoryService.addConclusion({
        text: quote,
        context: prevUserApi,
        dialogueId: dialogue.id,
        messageId: reply.id ?? '',
        sourceDocumentIds,
        confirmedBy: 'button',
      });
      if (res === 'failed') throw new Error('insight: write failed');
      return res;
    }, {
      successMessage: res => (res === 'saved' ? t('ai_insight_saved') : undefined),
      onSuccess: res => {
        if (res === 'duplicate') showToast(t('ai_insight_already_saved'), 'info');
        if (res === 'none') showToast(t('ai_insight_not_found'), 'info');
      },
    });
  }, [dialogue, execute, showToast, t]);

  const visible = flagOn && !!dialogue && HYPOTHESIS_PERSONAS.includes(dialogue.personaId);
  return { handleSaveInsight, busy: isLoading, visible };
}