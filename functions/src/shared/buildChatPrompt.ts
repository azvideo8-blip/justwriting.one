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

  let base = personaId === 'custom'
    ? `${customSystemPrompt ?? ''}\n\n${TOPIC_GUARD}\n\n${NOTES_GUARD}\n\n${REFLECTION_GUIDE}\n\n${SAFETY_GUIDE}`
    : `${(PERSONA_PROMPTS as Record<string, string>)[personaId] ?? PERSONA_PROMPTS.coach}\n\n${TOPIC_GUARD}\n\n${NOTES_GUARD}\n\n${REFLECTION_GUIDE}\n\n${SAFETY_GUIDE}`;

  // In reasoning mode: replace //<reasoning> with <reasoning> so model
  // outputs literal tags instead of treating them as comments.
  if (responseLength === 'reasoning') {
    base = base.replace(/\/\/<reasoning>/g, '<reasoning>');
  }

  if (responseLength === 'short') {
    base += '\n\nДЛИНА ОТВЕТА (приоритет выше формата персоны): ОЧЕНЬ кратко — 1–2 абзаца, без секций/заголовков/списков. Только суть + один вопрос.';
  } else if (responseLength === 'detailed') {
    base += '\n\nДЛИНА ОТВЕТА (приоритет выше формата персоны): развёрнутый, подробный ответ — полная структура персоны, глубокий анализ, несколько вопросов.';
  } else if (responseLength === 'reasoning') {
    base += '\n\nРЕЖИМ РАССУЖДЕНИЙ (приоритет выше формата персоны выше).\nОБЯЗАТЕЛЬНО начни ответ с тега <reasoning> (буквально, без //).\nСтруктура ответа:\n<reasoning>\nздесь твой анализ — ход мысли, выбор подхода, промежуточные выводы\n</reasoning>\n<answer>\nздесь итоговый ответ пользователю\n</answer>\nТеги должны быть в выводе буквально. Первые символы ответа — <reasoning>.';
  }

  // OPT-5: RAG context in system prompt, not as fake user turn
  if (documentContent) {
    const safeMood = documentMood ? documentMood : 'не указано';
    base += `\n\n---\n[Контекст из заметок пользователя]\n${documentContent}\n[Настроение: ${safeMood}]`;
  }

  if (userPortrait) {
    base = `${base}\n\n---\n[Портрет пользователя (личность, темы, контекст)]\n${userPortrait}`;
  }

  return base;
}

export function sanitizeAiInputShared(content: string): string {
  return content
    .replace(/<\|system\|>/gi, '[system]')
    .replace(/<\|user\|>/gi, '[user]')
    .replace(/<\|assistant\|>/gi, '[assistant]');
}
