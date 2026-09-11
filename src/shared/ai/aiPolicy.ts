// Centralized AI security policy — single source of truth for:
// - What constitutes an internal call (and what restrictions apply)
// - Which paths bypass per-user quota (and why)
// - The global guard that always applies
//
// All AI endpoints MUST use these helpers instead of inline checks.
// This prevents the C1-style bypass where a client flag silently disabled limits.

export type InternalCallType = 'auto_name' | 'follow_up' | 'query_expand';

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
  messages: unknown[];
}): { isInternal: boolean } {
  const isInternal = isInternalCall(params.callType);
  if (!isInternal) return { isInternal: false };

  const r = INTERNAL_CALL_RESTRICTIONS;
  const err = (msg: string) => ({ code: 'invalid-argument', message: msg });

  if (r.noCustomPersona && params.personaId === 'custom') {
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
  if (params.messages.length > r.maxMessages) {
    throw err(`Too many messages for internal call (max ${r.maxMessages}).`);
  }

  return { isInternal: true };
}

// The max token budget for a given call.
export function getMaxTokens(isInternal: boolean, reasoning: boolean | null | undefined): number {
  if (isInternal) return INTERNAL_CALL_RESTRICTIONS.maxTokens;
  return reasoning ? 16384 : 8192;
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

// AUDIT-MH8: Shared injection policy across streaming and non-streaming chat endpoints.
// Hard-rejects only apply to direct instructions (messages, customSystemPrompt).
// Note-derived content (documentContent, userPortrait, memoryContext, documentMood)
// comes from the user's own notes/archive and must NOT cause a self-DoS.
// Note-derived fields are fenced in DATA_CONTEXT_* blocks and sanitized via buildChatSystemPrompt.
export function assertNoSystemPromptInjection(params: {
  messages: Array<{ content: string }>;
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

  if (params.messages.some(m => hasInjectionAttempt(m.content))) {
    throw new AiError('invalid-argument', 'Disallowed patterns detected in messages.');
  }
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
      usageRecorded = true;
      await ctx.recordUsage(uid, tokensIn, tokensOut, opts, currentGlobal);
    },
    async settle(reason: SettleReason, usage?: CallReservationUsage) {
      if (isSettled) return;
      isSettled = true;
      outcome = reason;
      if (reason === 'done') {
        if (usage && (!currentGlobal || !currentGlobal.refunded)) {
          if (!usageRecorded) {
            usageRecorded = true;
            const meta: { model?: string; fn?: string } = { fn: 'chat-stream' };
            if (usage.model) meta.model = usage.model;
            await ctx.recordUsage(
              uid,
              usage.tokensIn ?? 0,
              usage.tokensOut ?? 0,
              meta,
              currentGlobal,
            );
          }
        }
        return;
      }

      res.refunded = true;
      // DEEP-8 & FU-5: A failed call always refunds the user/bulk slot.
      // A stream closed by the client or aborted by server/client only refunds the daily slot
      // if produced content was negligible (< 200 chars). Substantial partial answers keep the slot.
      if (reason === 'failed' || producedChars < REFUND_IF_PRODUCED_UNDER_CHARS) {
        if (charge === 'user') {
          await ctx.refundDailyLimit(uid, day);
        } else {
          await ctx.refundBulkLimit(uid, day);
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
        if (!usageRecorded) {
          usageRecorded = true;
          const tokensIn = usage?.tokensIn ?? currentEstimatedInput ?? 0;
          const tokensOut = usage?.tokensOut ?? Math.ceil(producedChars / 3);
          const meta: { model?: string; fn?: string } = { fn: 'chat-stream-abort' };
          if (usage?.model) meta.model = usage.model;
          await ctx.recordUsage(
            uid,
            tokensIn,
            tokensOut,
            meta,
            currentGlobal,
          );
        }
      }
    },
  };

  // Keep methods and getters non-enumerable so toEqual({ uid, charge, day, refunded: false }) passes
  Object.defineProperties(res, {
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
    const verdict = await ctx.checkAndIncrementBulkLimit(uid, 'chat');
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
    return createCallReservation(ctx, uid, 'bulk', verdict.day);
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
    if (limitResult === 'RATE_LIMIT') {
      throw new AiError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
    }
    return createCallReservation(ctx, uid, 'user', limitResult.day);
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
      await ctx.refundDailyLimit(resOrUid.uid, resOrUid.day);
      return;
    }
    await ctx.refundBulkLimit(resOrUid.uid, resOrUid.day);
    return;
  }
  const uid = resOrUid;
  const charge = maybeCharge ?? 'bulk';
  if (!chargedDay) {
    throw new Error('refundCall requires chargedDay when called with string uid');
  }
  if (charge === 'user') {
    await ctx.refundDailyLimit(uid, chargedDay);
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
