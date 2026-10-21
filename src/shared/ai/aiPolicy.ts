// Centralized AI security policy — single source of truth for:
// - What constitutes an internal call (and what restrictions apply)
// - Which paths bypass per-user quota (and why)
// - The global guard that always applies
//
// All AI endpoints MUST use these helpers instead of inline checks.
// This prevents the C1-style bypass where a client flag silently disabled limits.

export type InternalCallType = 'auto_name' | 'follow_up' | 'query_expand' | 'system_task';

export interface InternalCallRestrictions {
  maxTokens: number;
  maxMessages: number;
  noCustomPersona: boolean;
  noReasoning: boolean;
  noDocumentContent: boolean;
  noUserPortrait: boolean;
}

// The restrictions that apply to all internal calls. These make internal calls
// unattractive for abuse: low token budget, no rich context, no custom persona.
export const INTERNAL_CALL_RESTRICTIONS: InternalCallRestrictions = {
  maxTokens: 256,
  maxMessages: 3,
  noCustomPersona: true,
  noReasoning: true,
  noDocumentContent: true,
  noUserPortrait: true,
};

export const INTERNAL_CALL_MAX_INPUT_CHARS = 4000;

/**
 * R7Q-018: потолок входа `system_task`. Он выше общего для внутренних вызовов,
 * потому что легитимный самый большой клиент здесь — дайджест диалога: 10 окон
 * по `API_MSG_CAP` (9 500) = 95 000 знаков. Без потолка один аккаунт мог
 * зарезервировать на вызов оценку входа до 200 000 знаков и сделать 60 таких
 * вызовов в день из пула `internal_chat`.
 */
export const SYSTEM_TASK_MAX_INPUT_CHARS = 100_000;

export function isInternalCall(callType: InternalCallType | null | undefined): boolean {
  return callType !== undefined && callType !== null;
}

// Validate that an internal call respects its restrictions.
// Throws HttpsError-compatible error if violated.
export function validateInternalCallRestrictions(params: {
  callType: InternalCallType | null | undefined;
  personaId: string;
  reasoning?: boolean | null | undefined;
  documentContent?: string | null | undefined;
  userPortrait?: string | null | undefined;
  customSystemPrompt?: string | null | undefined;
  messages: unknown[];
}): { isInternal: boolean } {
  const isInternal = isInternalCall(params.callType);
  if (!isInternal) return { isInternal: false };

  const isSystemTask = params.callType === 'system_task';
  const maxMessages = isSystemTask ? 12 : INTERNAL_CALL_RESTRICTIONS.maxMessages;
  const r = INTERNAL_CALL_RESTRICTIONS;
  const err = (msg: string) => ({ code: 'invalid-argument', message: msg });

  if (!isSystemTask && r.noCustomPersona && params.personaId === 'custom') {
    throw err('Custom persona not allowed for internal calls.');
  }
  if (r.noReasoning && params.reasoning === true) {
    throw err('Reasoning mode not allowed for internal calls.');
  }
  if (r.noDocumentContent && params.documentContent) {
    throw err('Document content not allowed for internal calls.');
  }
  if (r.noUserPortrait && params.userPortrait) {
    throw err('User portrait not allowed for internal calls.');
  }
  if (params.messages.length > maxMessages) {
    throw err(`Too many messages for internal call (max ${maxMessages}).`);
  }
  // EA-1: служебный вызов идёт мимо дневного лимита чата. Свой системный
  // промпт у него — только из белого списка (system_task), у остальных — никакого,
  // иначе это бесплатная модель общего назначения с промптом клиента.
  if (isSystemTask ? !isAllowedSystemTaskPrompt(params.customSystemPrompt) : Boolean(params.customSystemPrompt)) {
    throw err('System prompt not allowed for this internal call.');
  }

  // DA-2: ограничить размер входа внутренних вызовов суммарно ≤ 4000 символов.
  // R7Q-018: у `system_task` своя, более высокая планка — до неё он был единственным
  // внутренним вызовом без границы входа при самом большом резерве на вызов.
  const inputCap = isSystemTask ? SYSTEM_TASK_MAX_INPUT_CHARS : INTERNAL_CALL_MAX_INPUT_CHARS;
  {
    const totalChars = (params.messages as Array<{ content?: unknown }>).reduce((sum, m) => {
      return sum + (typeof m?.content === 'string' ? m.content.length : 0);
    }, 0);
    if (totalChars > inputCap) {
      throw err(`Total input length exceeds ${inputCap} characters for internal call.`);
    }
  }

  return { isInternal: true };
}

// The max token budget for a given call.
//
// W-2: потолок ответа внешнего хода следует за выбранной человеком длиной.
// 8 192 на «кратко» означало, что лимит ничего не ограничивает: в живом прогоне
// §4.7 два ответа из 372 разрослись до 7–16 тыс. знаков внутреннего монолога.
export function getMaxTokens(
  isInternal: boolean,
  reasoning: boolean | null | undefined,
  callType?: InternalCallType | null | undefined,
  responseLength?: 'short' | 'standard' | 'detailed' | null | undefined,
): number {
  if (isInternal) {
    if (callType === 'system_task') return 2048;
    return INTERNAL_CALL_RESTRICTIONS.maxTokens;
  }
  if (reasoning) return 16384;
  if (responseLength === 'short') return 700;
  if (responseLength === 'standard') return 1500;
  return 3000;
}

// AUD-19: EFFECTIVE_TOKEN_LIMIT резервируется против ответа. Длинная заметка,
// ушедшая на анализ, тратит входные токены, которых никакой резерв не покрывает.
// Оценка входа считается на запросе и складывается с бюджетом ответа в
// tryReserveGlobalRequest; recordUsage сводит дельту как раньше.
export function estimateInputTokens(parts: Array<string | null | undefined>): number {
  const totalChars = parts.reduce((n, s) => n + (s?.length ?? 0), 0);
  // ~3 символа на токен для смешанного русско-английского текста; оценка
  // сознательно грубая — резерв всё равно сверяется с фактом в recordUsage.
  return Math.ceil(totalChars / 3);
}

// ── Кто платит за вызов ──────────────────────────────────────────────────────
//
// Фоновые эндпоинты по умолчанию списываются с отдельного фонового лимита
// (BULK_DAILY_LIMIT). Обновление профиля — работа, заказанная человеком, и она
// должна стоить ему видимых запросов из дневного лимита, иначе она бесплатна.
//
// Клиент присылает пометку `charge: 'user'`. Доверять ей безопасно: она может
// только повысить себе цену. Отсутствие пометки = фоновый лимит, как раньше,
// поэтому подделать удешевление нельзя.
//
// Кулдаун между чатовыми запросами (10 с) здесь сознательно не применяется:
// обновление профиля делает десяток вызовов подряд, и кулдаун превратил бы его
// в отказ на втором. Дневной счётчик при этом общий с чатом — именно он и
// ограничивает частоту.

import type { AiContext, GlobalReservation } from './context.js';
import { AiError } from './context.js';
import { hasInjectionAttempt } from './injectionPatterns.js';
import { isAllowedSystemTaskPrompt } from './systemTaskPrompts.js';

// Маркер приложенной заметки: строка целиком (см. useAIPageData / aiChatTransport).
// S-14: Non-greedy and bounded to avoid swallowing inline injections.
// S-44.5: предел — одно число на клиент и сервер: клиент режет название до него
// (cleanAttachedTitle), иначе длинное название с «забудь всё» отбивалось 400-кой.
export const ATTACHED_NOTE_TITLE_MAX = 200;
const ATTACHED_NOTE_MARKER = new RegExp(`^\\[Прикреплена заметка: "[^"\\n]{0,${ATTACHED_NOTE_TITLE_MAX}}"\\]$`, 'gm');

// AUDIT-MH8: Shared injection policy across streaming and non-streaming chat endpoints.
// Hard-rejects only apply to direct instructions (last user message, customSystemPrompt).
// Note-derived content (documentContent, userPortrait, memoryContext, documentMood)
// comes from the user's own notes/archive and must NOT cause a self-DoS.
// Note-derived fields are fenced in DATA_CONTEXT_* blocks and sanitized via buildChatSystemPrompt.
// L-2: историю (включая реплики ассистента) отклонять нельзя — одна неудачная
// реплика внутри контекстного окна кирпичила весь диалог с generic 400.
// Её санитизируют вызывающие; reject ловит только последний ход пользователя.
// Сообщение без роли считается пользовательским (fail-closed).
export function assertNoSystemPromptInjection(params: {
  messages: Array<{ role?: string; content: string }>;
  customSystemPrompt?: string | null | undefined;
  personaId?: string;
}): void {
  if (params.personaId === 'custom') {
    if (!params.customSystemPrompt) {
      throw new AiError('invalid-argument', 'customSystemPrompt is required when personaId is "custom".');
    }
    if (hasInjectionAttempt(params.customSystemPrompt)) {
      throw new AiError('invalid-argument', 'Custom prompt failed security check.');
    }
  }

  const isUserTurn = (m: { role?: string }) => m.role === 'user' || m.role === undefined;
  const lastUser = [...params.messages].reverse().find(isUserTurn);
  // R5-022: заголовок приложенной заметки — данные из архива, как и её тело
  // (тело клиент вырезает, aiChatTransport.toApiContent). «Забудь всё» в
  // заголовке отбивало весь диалог 400-кой.
  if (lastUser && hasInjectionAttempt(lastUser.content.replace(ATTACHED_NOTE_MARKER, ''))) {
    // X-2: отдельный код отказа. Клиент по «400 вообще» показывал «Ошибка
    // сервиса. Попробуй позже.», хотя повтор той же реплики никогда не помогает:
    // здесь нужен честный «перефразируй», а не обещание повтора.
    throw new AiError('DISALLOWED_PHRASE', 'Disallowed patterns detected in messages.');
  }
  // История санитизируется у вызывающих: api/chat.ts и api/ai/chatWithAI.logic.ts (providerMessages).
}

export type ChargeTarget = 'bulk' | 'user';

export function parseCharge(value: unknown): ChargeTarget {
  return value === 'user' ? 'user' : 'bulk';
}

export const REFUND_IF_PRODUCED_UNDER_CHARS = 200;

export type SettleReason = 'done' | 'failed' | 'closed' | 'abort';

export interface CallReservationUsage {
  tokensIn?: number;
  tokensOut?: number;
  model?: string;
}

export interface CallReservation {
  readonly uid: string;
  readonly charge: ChargeTarget;
  /** День списания из verdict'а. Refund целится в него, а не в today() на
   *  момент неудачи — иначе запрос, списавший квоту в 23:58 и упавший после
   *  полуночи, возвращает единицу в пустую строку. */
  readonly day: string;
  readonly kind?: 'chat' | 'reasoning' | string | undefined;
  refunded?: boolean;
  readonly globalReservation?: GlobalReservation | null;
  readonly upstreamProduced?: boolean;
  readonly producedChars?: number;
  readonly settled?: boolean;
  readonly usageRecorded?: boolean;
  readonly outcome?: SettleReason | undefined;
  readonly estimatedInputTokens?: number | undefined;
  attachGlobalReservation(res: GlobalReservation | null, estimatedInputTokens?: number): void;
  markProduced(chars?: number): void;
  recordUsage(tokensIn: number, tokensOut: number, opts?: { model?: string; fn?: string }): Promise<void>;
  settle(reason: SettleReason, usage?: CallReservationUsage): Promise<void>;
}

export function createCallReservation(
  ctx: AiContext,
  uid: string,
  charge: ChargeTarget,
  day: string,
  globalReservation: GlobalReservation | null = null,
  estimatedInputTokens?: number,
  kind?: 'chat' | 'reasoning' | string,
): CallReservation {
  let isSettled = false;
  let upstreamProduced = false;
  let producedChars = 0;
  let currentGlobal = globalReservation;
  let currentEstimatedInput = estimatedInputTokens;
  let outcome: SettleReason | undefined = undefined;
  let usageRecorded = false;

  const res: CallReservation = {
    uid,
    charge,
    day,
    kind,
    refunded: false,
    get globalReservation() {
      return currentGlobal;
    },
    get upstreamProduced() {
      return upstreamProduced;
    },
    get producedChars() {
      return producedChars;
    },
    get settled() {
      return isSettled;
    },
    get usageRecorded() {
      return usageRecorded;
    },
    get outcome() {
      return outcome;
    },
    get estimatedInputTokens() {
      return currentEstimatedInput;
    },
    attachGlobalReservation(reservation: GlobalReservation | null, estimatedInput?: number) {
      currentGlobal = reservation;
      if (estimatedInput !== undefined) {
        currentEstimatedInput = estimatedInput;
      }
    },
    /**
     * S-11 / L-5 Policy: "A model that answered badly still costs what it cost."
     * Call markProduced(chars) as soon as the upstream model produces an answer,
     * BEFORE parsing JSON or validating schemas.
     * When upstream has produced content, settle('failed') reconciles the global token
     * reservation against actual/estimated usage rather than fully refunding the ceiling.
     */
    markProduced(chars = 0) {
      upstreamProduced = true;
      producedChars += chars;
    },
    async recordUsage(tokensIn: number, tokensOut: number, opts?: { model?: string; fn?: string }) {
      if (usageRecorded) return;
      // R4-053: защёлка ставится сразу (защита от гонки с параллельным
      // settle), но при сбое await снимается — один сбой БД больше не
      // блокирует повтор навсегда и не зависает резерв в ai_global_daily.
      usageRecorded = true;
      try {
        await ctx.recordUsage(uid, tokensIn, tokensOut, opts, currentGlobal);
      } catch (e) {
        usageRecorded = false;
        throw e;
      }
    },
    async settle(reason: SettleReason, usage?: CallReservationUsage) {
      if (isSettled) return;
      isSettled = true;
      outcome = reason;
      try {
      if (reason === 'done') {
        if (usage && (!currentGlobal || !currentGlobal.refunded)) {
          // C-2: пустой usage — не «ноль потрачено». Ответ уже тек в потоке,
          // и recordUsage(0, 0) возвращал весь резерв в котёл. Оцениваем так же,
          // как ветку failed: вход — замер до запроса, выход — по символам.
          const measuredIn = usage.tokensIn ?? 0;
          const measuredOut = usage.tokensOut ?? 0;
          const emptyUsage = measuredIn + measuredOut === 0 && producedChars > 0;
          const tokensIn = emptyUsage ? (currentEstimatedInput ?? 0) : measuredIn;
          const tokensOut = emptyUsage ? Math.ceil(producedChars / 3) : measuredOut;
          await res.recordUsage(tokensIn, tokensOut, { fn: 'chat-stream', ...(usage.model ? { model: usage.model } : {}) });
        }
        return;
      }

      // S-11 / T-1: A slot is refunded only when the provider produced less than
      // REFUND_IF_PRODUCED_UNDER_CHARS, whatever the settle reason.
      // Upstream failure before production (producedChars === 0) still refunds.
      // A stream or call that produced substantial text keeps the slot charged.
      if (producedChars < REFUND_IF_PRODUCED_UNDER_CHARS) {
        res.refunded = true;
        if (charge === 'user') {
          if (kind && kind !== 'chat') {
            await ctx.refundDailyLimit(uid, day, kind);
          } else {
            await ctx.refundDailyLimit(uid, day);
          }
          if (reason === 'failed' && !upstreamProduced && typeof ctx.resetCooldown === 'function') {
            await ctx.resetCooldown(uid);
          }
        } else {
          await ctx.refundBulkLimit(uid, day, kind ?? 'bulk');
        }
      }
      if (!upstreamProduced && currentGlobal) {
        await ctx.refundGlobalRequest(currentGlobal);
      } else if (upstreamProduced && (!currentGlobal || !currentGlobal.refunded)) {
        // FU-1 & FU-4: Stream aborted or failed mid-stream after upstream produced chunks.
        // Reconcile global token reservation against actual or estimated usage so
        // the unconsumed remainder is refunded to ai_global_daily.
        // Prompt tokens (input) were genuinely consumed before upstream started producing;
        // fallback to estimatedInputTokens if usage.tokensIn is absent on abort.
        await res.recordUsage(
          usage?.tokensIn ?? currentEstimatedInput ?? 0,
          usage?.tokensOut ?? Math.ceil(producedChars / 3),
          { fn: 'chat-stream-abort', ...(usage?.model ? { model: usage.model } : {}) },
        );
      }
      } catch (e) {
        // R4-053: сбой внутри settle не должен защёлкивать резервацию —
        // повторный settle обязан вернуть резерв.
        isSettled = false;
        throw e;
      }
    },
  };

  // Keep methods and getters non-enumerable so toEqual({ uid, charge, day, refunded: false }) passes
  Object.defineProperties(res, {
    kind: { enumerable: false },
    globalReservation: { enumerable: false },
    upstreamProduced: { enumerable: false },
    producedChars: { enumerable: false },
    settled: { enumerable: false },
    usageRecorded: { enumerable: false },
    outcome: { enumerable: false },
    estimatedInputTokens: { enumerable: false },
    attachGlobalReservation: { enumerable: false },
    markProduced: { enumerable: false },
    recordUsage: { enumerable: false },
    settle: { enumerable: false },
  });

  return res;
}

/** Списывает вызов с нужного счётчика. Возвращает объект резервации для идемпотентного возврата. Бросает AiError, если лимит исчерпан.
 *  AUD-18: `endpoint` ключует интервальный кулдаун (uid, endpoint); без него
 *  кулдаун общий на все фоновые вызовы. */
export async function chargeCall(ctx: AiContext, uid: string, charge: ChargeTarget, endpoint?: string): Promise<CallReservation> {
  if (charge === 'user') {
    const verdict = await ctx.checkDailyLimit(uid);
    if (!verdict.ok) {
      if (verdict.reason === 'unavailable') {
        throw new AiError('unavailable', 'The service could not check the daily limit.');
      }
      if (verdict.reason === 'unauthorized') {
        throw new AiError('unauthenticated', 'User no longer exists.');
      }
      throw new AiError('resource-exhausted', 'Daily limit reached.');
    }
    return createCallReservation(ctx, uid, charge, verdict.day);
  }
  const verdict = await ctx.checkAndIncrementBulkLimit(uid, endpoint);
  if (verdict === 'RATE_LIMIT') {
    throw new AiError('resource-exhausted', 'Too many requests. Please wait a minute.');
  }
  if (!verdict.ok) {
    if (verdict.reason === 'unavailable') {
      throw new AiError('unavailable', 'The service could not check the daily limit.');
    }
    if (verdict.reason === 'unauthorized') {
      throw new AiError('unauthenticated', 'User no longer exists.');
    }
    throw new AiError('resource-exhausted', 'Daily bulk operations limit reached.');
  }
  return createCallReservation(ctx, uid, charge, verdict.day);
}

/**
 * DUP-1: Combined chat quota reservation for streaming & non-streaming endpoints.
 */
export async function acquireChatReservation(
  ctx: AiContext,
  uid: string,
  isInternalCall: boolean,
  reasoning?: boolean,
): Promise<CallReservation> {
  if (isInternalCall) {
    const verdict = await ctx.checkAndIncrementBulkLimit(uid, 'chat', 'internal_chat');
    if (verdict === 'RATE_LIMIT') {
      throw new AiError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
    }
    if (!verdict.ok) {
      if (verdict.reason === 'unavailable') {
        throw new AiError('unavailable', 'The service could not check the daily limit.');
      }
      if (verdict.reason === 'unauthorized') {
        throw new AiError('unauthenticated', 'User no longer exists.');
      }
      throw new AiError('resource-exhausted', 'Daily limit reached.');
    }
    return createCallReservation(ctx, uid, 'bulk', verdict.day, null, undefined, 'internal_chat');
  } else {
    const limitResult = await ctx.checkAndIncrementLimit(uid, reasoning === true);
    if (limitResult === 'UNAVAILABLE') {
      throw new AiError('unavailable', 'The service could not check the daily limit.');
    }
    if (limitResult === 'UNAUTHORIZED') {
      throw new AiError('unauthenticated', 'User no longer exists.');
    }
    if (limitResult === 'DAILY_LIMIT') {
      throw new AiError('resource-exhausted', 'Daily limit reached.');
    }
    if (limitResult === 'REASONING_LIMIT') {
      throw new AiError('resource-exhausted', 'Reasoning limit reached.');
    }
    if (typeof limitResult === 'object' && 'error' in limitResult) {
      const retryAfterSec = limitResult.retryAfterSec;
      const msg = retryAfterSec ? `Too many requests. Please wait ${retryAfterSec} seconds.` : 'Too many requests. Please wait a few seconds.';
      throw new AiError('resource-exhausted', msg, retryAfterSec);
    }
    if (limitResult === 'RATE_LIMIT') {
      throw new AiError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
    }
    return createCallReservation(ctx, uid, 'user', limitResult.day, null, undefined, reasoning ? 'reasoning' : 'chat');
  }
}

/** Возврат списанного с гарантией идемпотентности: повторный вызов с той же резервацией ничего не делает. */
export async function refundCall(
  ctx: AiContext,
  resOrUid: CallReservation | string | null | undefined,
  maybeCharge?: ChargeTarget,
  chargedDay?: string,
): Promise<void> {
  if (resOrUid == null) return;
  if (typeof resOrUid === 'object') {
    if (typeof resOrUid.settle === 'function') {
      await resOrUid.settle('failed');
      return;
    }
    if (resOrUid.refunded === true) return;
    resOrUid.refunded = true;
    if (resOrUid.charge === 'user') {
      if (resOrUid.kind && resOrUid.kind !== 'chat') {
        await ctx.refundDailyLimit(resOrUid.uid, resOrUid.day, resOrUid.kind);
      } else {
        await ctx.refundDailyLimit(resOrUid.uid, resOrUid.day);
      }
      return;
    }
    await ctx.refundBulkLimit(resOrUid.uid, resOrUid.day, resOrUid.kind ?? 'bulk');
    return;
  }
  const uid = resOrUid;
  const charge = maybeCharge ?? 'bulk';
  if (!chargedDay) {
    throw new Error('refundCall requires chargedDay when called with string uid');
  }
  if (charge === 'user') {
    await ctx.refundDailyLimit(uid, chargedDay);
    if (typeof ctx.resetCooldown === 'function') {
      await ctx.resetCooldown(uid);
    }
    return;
  }
  await ctx.refundBulkLimit(uid, chargedDay);
}

// Пределы извлечения долговременной памяти из диалога.
//
// Жили порознь: схема на сервере разрешала 30 сообщений, клиент слал 40, а
// комментарий рядом с ним обещал 50. Любой разговор длиннее тридцати реплик
// отлетал с «Invalid payload» — то есть память переставала извлекаться ровно у
// тех, кто разговаривает много. Один источник на обе стороны.
export const MEMORY_EXTRACT_MAX_MESSAGES = 30;
export const MEMORY_EXTRACT_MAX_MESSAGE_CHARS = 5_000;
