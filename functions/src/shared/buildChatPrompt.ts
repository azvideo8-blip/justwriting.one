// CHATFIX-6: Shared system prompt builder for both api/chat.ts and
// functions/src/ai/chatWithAI.ts. Keep behavior identical across backends.
import { PERSONA_PROMPTS, TOPIC_GUARD, NOTES_GUARD, REFLECTION_GUIDE, SAFETY_GUIDE } from './prompts';

export function buildChatSystemPrompt(params: {
  personaId: string;
  customSystemPrompt?: string | null | undefined;
  userPortrait?: string | null | undefined;
  responseLength?: 'short' | 'standard' | 'detailed' | null | undefined;
  reasoning?: boolean | null | undefined;
  documentContent?: string | null | undefined;
  documentMood?: string | null | undefined;
}): string {
  const { personaId, customSystemPrompt, userPortrait, responseLength, reasoning, documentContent, documentMood } = params;

  // AX-11: Reasoning is now a separate boolean flag, decoupled from length.
  let reasoningPrefix = '';
  if (reasoning) {
    reasoningPrefix = `ФОРМАТ ОТВЕТА (обязательно):
Твой ответ состоит из двух разделов, разделённых заголовком.
Первый раздел начни со строки: ХОД МЫСЛИ:
За ней напиши свой анализ — ход рассуждений, выбор подхода, промежуточные выводы.
Затем напиши строку: ОТВЕТ:
За ней напиши итоговый ответ пользователю.
Это не шаблон — это требование к формату вывода.\n\n`;
  }

  let base = personaId === 'custom'
    ? `${customSystemPrompt ?? ''}\n\n${TOPIC_GUARD}\n\n${NOTES_GUARD}\n\n${REFLECTION_GUIDE}\n\n${SAFETY_GUIDE}`
    : `${(PERSONA_PROMPTS as Record<string, string>)[personaId] ?? PERSONA_PROMPTS.coach}\n\n${TOPIC_GUARD}\n\n${NOTES_GUARD}\n\n${REFLECTION_GUIDE}\n\n${SAFETY_GUIDE}`;

  if (reasoning) {
    base = base
      .replace(/\/\/<reasoning>/g, '[ВНУТРЕННИЙ АНАЛИЗ]')
      .replace(/<\/reasoning>/g, '[/ВНУТРЕННИЙ АНАЛИЗ]')
      .replace(/<answer>/g, '[ОТВЕТ ПОЛЬЗОВАТЕЛЮ]')
      .replace(/<\/answer>/g, '[/ОТВЕТ ПОЛЬЗОВАТЕЛЮ]');
  }

  // AX-11: Strengthen length differences.
  if (responseLength === 'short') {
    base += '\n\nДЛИНА ОТВЕТА (приоритет выше формата персоны): ОЧЕНЬ кратко — 1–2 абзаца, без секций/заголовков/списков. Только суть + один вопрос.';
  } else if (responseLength === 'standard') {
    base += '\n\nДЛИНА ОТВЕТА (приоритет выше формата персоны): умеренно — 3–5 абзацев, без избыточных секций. Суть + краткое раскрытие + 1–2 вопроса.';
  } else if (responseLength === 'detailed') {
    base += '\n\nДЛИНА ОТВЕТА (приоритет выше формата персоны): развёрнутый, подробный ответ — полная структура персоны, глубокий анализ, несколько вопросов.';
  }

  if (documentContent) {
    const safeMood = documentMood ? documentMood : 'не указано';
    base += `\n\n---\n[Контекст из заметок пользователя]\n${documentContent}\n[Настроение: ${safeMood}]`;
  }

  if (userPortrait) {
    base = `${base}\n\n---\n[Портрет пользователя (личность, темы, контекст)]\n${userPortrait}`;
  }

  return reasoningPrefix + base;
}

export function sanitizeAiInputShared(content: string): string {
  return content
    .replace(/<\|system\|>/gi, '[system]')
    .replace(/<\|user\|>/gi, '[user]')
    .replace(/<\|assistant\|>/gi, '[assistant]');
}
