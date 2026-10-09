// A-4: диагностика состава запроса — только размеры.
//
// Случай «приложил заметку в продолженный диалог, ответ не по ней» разбирался по
// догадкам: по `public.ai_usage_calls` видно только число токенов, а что именно
// вошло в запрос — нет. Эти строки в журнале службы отвечают на вопрос «из чего
// собран ход» без единого символа пользовательского текста: логи читаются кем
// угодно, а приложение пишет про людей.
import type { NoteScope } from './buildChatPrompt.js';

const PERSONA_IDS = ['group_psychology', 'cbt', 'coach', 'editor', 'parts', 'custom'] as const;

export interface ChatShapeLog {
  persona: string;
  scope: 'note' | 'wide' | null;
  crisis: boolean;
  reasoning: boolean;
  msgs: number;
  histChars: number;
  docChars: number;
  portraitChars: number;
  memoryChars: number;
  systemChars: number;
}

export interface ChatShapeInput {
  personaId: string;
  noteScope?: Pick<NoteScope, 'mode'> | null | undefined;
  crisis?: boolean | null | undefined;
  reasoning?: boolean | null | undefined;
  messages: readonly { content: string }[];
  documentContent?: string | null | undefined;
  userPortrait?: string | null | undefined;
  memoryContext?: string | null | undefined;
  system: string;
}

/**
 * Форма запроса. Значения полей — числа, булевы и значения из закрытых
 * перечислений; строкового содержимого (текст, названия, id) здесь нет по
 * построению: функция видит только длины.
 */
export function chatShape(input: ChatShapeInput): ChatShapeLog {
  const persona = (PERSONA_IDS as readonly string[]).includes(input.personaId) ? input.personaId : 'other';
  return {
    persona,
    scope: input.noteScope?.mode ?? null,
    crisis: input.crisis === true,
    reasoning: input.reasoning === true,
    msgs: input.messages.length,
    histChars: input.messages.reduce((sum, m) => sum + m.content.length, 0),
    docChars: input.documentContent?.length ?? 0,
    portraitChars: input.userPortrait?.length ?? 0,
    memoryChars: input.memoryContext?.length ?? 0,
    systemChars: input.system.length,
  };
}

export function logChatShape(input: ChatShapeInput): void {
  // eslint-disable-next-line no-console -- A-4: уровень info для служебной строки журнала; больше нигде в src не используется
  console.info('[chat-shape]', JSON.stringify(chatShape(input)));
}
