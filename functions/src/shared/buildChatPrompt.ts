// CHATFIX-6: Mirror of src/shared/ai/buildChatPrompt.ts
// After Supabase migration both sides will import from a single shared package.
import { PERSONA_PROMPTS, TOPIC_GUARD, NOTES_GUARD, REFLECTION_GUIDE, SAFETY_GUIDE, type PersonaId } from './prompts';

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

  if (responseLength === 'short') {
    base += '\n\nВАЖНО: Верни очень краткий, лаконичный ответ. Уложись в 1-2 абзаца, пиши только самое главное без долгих вступлений.';
  } else if (responseLength === 'detailed') {
    base += '\n\nВАЖНО: Верни подробный, развёрнутый ответ с глубоким анализом, детальными объяснениями и выводами.';
  } else if (responseLength === 'reasoning') {
    base += '\n\nВАЖНО: Сначала выведи ход своих рассуждений в тегах <reasoning>...</reasoning> — анализ записи, выбор подхода, промежуточные выводы. Затем выведи итоговый ответ в тегах <answer>...</answer> — глубокий структурированный разбор. Обе части обязательны.';
  }

  if (documentContent) {
    const safeMood = documentMood ? documentMood : 'не указано';
    base += `\n\n---\n[Контекст из заметок пользователя]\n${documentContent}\n[Настроение: ${safeMood}]`;
  }

  if (userPortrait) {
    base = `${base}\n\n---\n[Портрет пользователя (личность, темы, контекст)]\n${userPortrait}`;
  }

  return base;
}
