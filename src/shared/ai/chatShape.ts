// A-4: диагностика состава запроса — только размеры.
//
// Случай «приложил заметку в продолженный диалог, ответ не по ней» разбирался по
// догадкам: по `public.ai_usage_calls` видно только число токенов, а что именно
// вошло в запрос — нет. Эти строки в журнале службы отвечают на вопрос «из чего
// собран ход» без единого символа пользовательского текста: логи читаются кем
// угодно, а приложение пишет про людей.
import type { NoteScope } from './buildChatPrompt.js';
import { INSIGHT_RECALL_MARK } from './insightRecall.js';
import type { TurnAudit } from './answerAudit.js';

const PERSONA_IDS = ['group_psychology', 'cbt', 'coach', 'editor', 'parts', 'ta', 'custom'] as const;

/**
 * Разбор 18.11: шаги подбора опор гипотезы — сколько кандидатов, сколько выбрал
 * служебный вызов, у скольких нашёлся отрывок, сколько осталось после фильтра
 * «опоры о разном», сколько показано. Только числа.
 */
export interface HypoStats { cands: number; picked: number; quoted: number; diverse: number; shown: number }

export interface ChatShapeLog {
  persona: string;
  scope: 'note' | 'wide' | null;
  crisis: boolean;
  reasoning: boolean;
  /** Разбор 18.11: выбранный объём — по нему видно, дошёл ли он до сервера. */
  length: 'short' | 'standard' | 'detailed' | null;
  msgs: number;
  histChars: number;
  docChars: number;
  portraitChars: number;
  memoryChars: number;
  systemChars: number;
  hypo?: HypoStats;
  /** DI-7: блок прошлого вывода положен в ход (метка в материалах). */
  recall?: number;
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
  responseLength?: string | null | undefined;
  hypoStats?: HypoStats | null | undefined;
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
    length: input.responseLength === 'short' || input.responseLength === 'standard' || input.responseLength === 'detailed' ? input.responseLength : null,
    msgs: input.messages.length,
    histChars: input.messages.reduce((sum, m) => sum + m.content.length, 0),
    docChars: input.documentContent?.length ?? 0,
    portraitChars: input.userPortrait?.length ?? 0,
    memoryChars: input.memoryContext?.length ?? 0,
    systemChars: input.system.length,
    ...(input.hypoStats ? { hypo: { cands: input.hypoStats.cands, picked: input.hypoStats.picked, quoted: input.hypoStats.quoted, diverse: input.hypoStats.diverse, shown: input.hypoStats.shown } } : {}),
    ...(input.documentContent?.includes(INSIGHT_RECALL_MARK) ? { recall: 1 } : {}),
  };
}

export function logChatShape(input: ChatShapeInput): void {
  // eslint-disable-next-line no-console -- A-4: уровень info для служебной строки журнала; больше нигде в src не используется
  console.info('[chat-shape]', JSON.stringify(chatShape(input)));
}

// DR-8: подробный ответ встал на середине слова, и по журналу нельзя было
// разобрать почему — серверный срок (150 с), клиент, провайдер или лимит токенов.
// Одна строка на ход: причина, длительность и выданные токены, с 0.9.37 — плюс
// аудит ответа против материалов (MD-2). Перечисление, булевы и числа, текста нет
// по построению (см. serverLogsPrivacy.audit42).
export type ChatEndReason = 'stop' | 'length' | 'provider_error' | 'deadline' | 'client_abort';

export interface ChatEndSignals {
  /** Клиент ушёл (res 'close') — важнее всех остальных сигналов. */
  clientClosed: boolean;
  providerError: boolean;
  timedOut: boolean;
  /** finish_reason от поставщика, если он приходил ('stop' | 'length' | …). */
  providerFinish?: string | null | undefined;
  outTokens: number;
  maxTokens: number;
  /**
   * MD-2: аудит ответа против материалов хода (`auditAnswer`). Поля добавляются
   * к строке только когда они есть — без материалов хода считать нечего, и
   * состав строки остаётся прежним. Четыре поля: два булевых и два числа, текста
   * нет.
   */
  audit?: TurnAudit | null | undefined;
}

/**
 * DY7-8: ход упёрся в потолок вывода — одно правило для журнала и для пометки
 * в ответе на всех путях (оба потока `api/chat.ts`, `chatWithAI`). Поставщик
 * не всегда присылает finish_reason — тогда решает выдача на потолке.
 */
export function answerHitLimit(s: Pick<ChatEndSignals, 'providerFinish' | 'outTokens' | 'maxTokens'>): boolean {
  return s.providerFinish === 'length' || (s.maxTokens > 0 && s.outTokens >= s.maxTokens);
}

/** Порядок проверок = приоритет причин: уход клиента видно даже при «stop». */
export function chatEndReason(s: ChatEndSignals): ChatEndReason {
  if (s.clientClosed) return 'client_abort';
  if (s.providerError) return 'provider_error';
  if (s.timedOut) return 'deadline';
  if (answerHitLimit(s)) return 'length';
  return 'stop';
}

/**
 * Recorder на один ход: печатает `[chat-end]` ровно один раз. Возвращает функцию,
 * потому что у хода несколько точек выхода (штатный конец, ошибка, уход клиента),
 * а строка обязана быть одна.
 */
export function chatEndRecorder(startedAt: number): (signals: ChatEndSignals) => void {
  let written = false;
  return (signals) => {
    if (written) return;
    written = true;
    const line = JSON.stringify({
      finish: chatEndReason(signals),
      ms: Math.max(0, Date.now() - startedAt),
      out_tokens: signals.outTokens,
      ...(signals.audit ?? {}),
    });
    // eslint-disable-next-line no-console -- DR-8: служебная строка журнала, размеры и перечисление
    console.info('[chat-end]', line);
  };
}
