// CHATFIX-6: Shared system prompt builder for both api/chat.ts and
// functions/src/ai/chatWithAI.ts. Keep behavior identical across backends.
// NOTE: keep the .js extension — Vercel runs api/* as native ESM (no bundling),
// so an extensionless relative import fails at runtime with ERR_MODULE_NOT_FOUND
// and 500s the whole /api/chat endpoint. Vite resolves the .js → .ts for the SPA.
import { PERSONA_PROMPTS, TOPIC_GUARD, NOTES_GUARD, REFLECTION_GUIDE, SAFETY_GUIDE } from './prompts.js';

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
  // The reasoning prefix instructs the model to output two sections.
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

  // In reasoning mode: remove <reasoning>/<answer> structural tags from persona
  // so they don't conflict with the output format instruction.
  if (reasoning) {
    base = base
      .replace(/\/\/<reasoning>/g, '[ВНУТРЕННИЙ АНАЛИЗ]')
      .replace(/<\/reasoning>/g, '[/ВНУТРЕННИЙ АНАЛИЗ]')
      .replace(/<answer>/g, '[ОТВЕТ ПОЛЬЗОВАТЕЛЮ]')
      .replace(/<\/answer>/g, '[/ОТВЕТ ПОЛЬЗОВАТЕЛЮ]');
  }

  // AX-11: Strengthen length differences so the user feels them.
  if (responseLength === 'short') {
    base += '\n\nДЛИНА ОТВЕТА (приоритет выше формата персоны): ОЧЕНЬ кратко — 1–2 абзаца, без секций/заголовков/списков. Только суть + один вопрос.';
  } else if (responseLength === 'standard') {
    base += '\n\nДЛИНА ОТВЕТА (приоритет выше формата персоны): умеренно — 3–5 абзацев, без избыточных секций. Суть + краткое раскрытие + 1–2 вопроса.';
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
  let sanitized = content.slice(0, 50_000);
  sanitized = sanitized.replace(/<\|system\|>/gi, '[system]');
  sanitized = sanitized.replace(/<\|user\|>/gi, '[user]');
  sanitized = sanitized.replace(/<\|assistant\|>/gi, '[assistant]');
  sanitized = sanitized.replace(/<\|im_start\|>/gi, '[im_start]');
  sanitized = sanitized.replace(/<\|im_end\|>/gi, '[im_end]');
  sanitized = sanitized.replace(/\[INST\]/gi, '[inst]');
  sanitized = sanitized.replace(/<\/?developer>/gi, '[developer]');
  sanitized = sanitized.replace(/<end_of_turn>/gi, '[end_of_turn]');
  sanitized = sanitized.replace(/\u200B|\u200C|\u200D|\uFEFF|\u00AD/g, '');
  sanitized = sanitized.replace(/\u2000|\u2001|\u2002|\u2003|\u2004|\u2005|\u2006|\u2007|\u2008|\u2009|\u200A|\u2028|\u2029|\u202F|\u205F/g, ' ');
  return sanitized;
}
