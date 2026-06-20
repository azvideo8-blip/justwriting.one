// CHATFIX-6: Shared system prompt builder for both api/chat.ts and
// functions/src/ai/chatWithAI.ts. Keep behavior identical across backends.
import { PERSONA_PROMPTS, TOPIC_GUARD, NOTES_GUARD, REFLECTION_GUIDE, SAFETY_GUIDE } from './prompts';

export function buildChatSystemPrompt(params: {
  personaId: string;
  customSystemPrompt?: string | null | undefined;
  userPortrait?: string | null | undefined;
  responseLength?: 'short' | 'standard' | 'detailed' | 'reasoning' | null | undefined;
  documentContent?: string | null | undefined;
  documentMood?: string | null | undefined;
}): string {
  const { personaId, customSystemPrompt, userPortrait, responseLength, documentContent, documentMood } = params;

  // UXFIX-1: In reasoning mode, put the output format instruction FIRST,
  // before the persona, so the model sees it before any template tags.
  let reasoningPrefix = '';
  if (responseLength === 'reasoning') {
    reasoningPrefix = `КРИТИЧЕСКОЕ УКАЗАНИЕ ПО ФОРМАТУ ВЫВОДА (высший приоритет, выше всего остального):
Твой ответ ДОЛЖЕН начинаться с символов <reasoning> — это не комментарий, это буквальный тег для вывода.
Формат ответа (теги выводятся буквально):
<reasoning>
[здесь твой анализ: ход мысли, выбор подхода, промежуточные выводы]
</reasoning>
<answer>
[здесь итоговый ответ пользователю]
</answer>
НЕ начинай ответ с текста. Первый символ ответа — < .\n\n`;
  }

  let base = personaId === 'custom'
    ? `${customSystemPrompt ?? ''}\n\n${TOPIC_GUARD}\n\n${NOTES_GUARD}\n\n${REFLECTION_GUIDE}\n\n${SAFETY_GUIDE}`
    : `${(PERSONA_PROMPTS as Record<string, string>)[personaId] ?? PERSONA_PROMPTS.coach}\n\n${TOPIC_GUARD}\n\n${NOTES_GUARD}\n\n${REFLECTION_GUIDE}\n\n${SAFETY_GUIDE}`;

  // In reasoning mode: replace //<reasoning> with <reasoning> so model
  // doesn't treat them as comments.
  if (responseLength === 'reasoning') {
    base = base.replace(/\/\/<reasoning>/g, '<reasoning>');
  }

  if (responseLength === 'short') {
    base += '\n\nДЛИНА ОТВЕТА (приоритет выше формата персоны): ОЧЕНЬ кратко — 1–2 абзаца, без секций/заголовков/списков. Только суть + один вопрос.';
  } else if (responseLength === 'detailed') {
    base += '\n\nДЛИНА ОТВЕТА (приоритет выше формата персоны): развёрнутый, подробный ответ — полная структура персоны, глубокий анализ, несколько вопросов.';
  }

  // OPT-5: RAG context in system prompt, not as fake user turn
  if (documentContent) {
    const safeMood = documentMood ? documentMood : 'не указано';
    base += `\n\n---\n[Контекст из заметок пользователя]\n${documentContent}\n[Настроение: ${safeMood}]`;
  }

  if (userPortrait) {
    base = `${base}\n\n---\n[Портрет пользователя (личность, темы, контекст)]\n${userPortrait}`;
  }

  // Reasoning prefix goes FIRST, before everything else
  return reasoningPrefix + base;
}

export function sanitizeAiInputShared(content: string): string {
  return content
    .replace(/<\|system\|>/gi, '[system]')
    .replace(/<\|user\|>/gi, '[user]')
    .replace(/<\|assistant\|>/gi, '[assistant]');
}
