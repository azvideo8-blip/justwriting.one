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

import type { AiContext } from './context.js';
import { AiError } from './context.js';

export type ChargeTarget = 'bulk' | 'user';

export function parseCharge(value: unknown): ChargeTarget {
  return value === 'user' ? 'user' : 'bulk';
}

export interface CallReservation {
  uid: string;
  charge: ChargeTarget;
  /** День списания из verdict'а. Refund целится в него, а не в today() на
   *  момент неудачи — иначе запрос, списавший квоту в 23:58 и упавший после
   *  полуночи, возвращает единицу в пустую строку. */
  day?: string;
  refunded?: boolean;
}

/** Списывает вызов с нужного счётчика. Возвращает объект резервации для идемпотентного возврата. Бросает AiError, если лимит исчерпан. */
export async function chargeCall(ctx: AiContext, uid: string, charge: ChargeTarget): Promise<CallReservation> {
  if (charge === 'user') {
    const verdict = await ctx.checkDailyLimit(uid);
    if (!verdict.ok) throw new AiError('resource-exhausted', 'Daily limit reached.');
    return { uid, charge, day: verdict.day, refunded: false };
  }
  const verdict = await ctx.checkAndIncrementBulkLimit(uid);
  if (!verdict.ok) throw new AiError('resource-exhausted', 'Daily bulk operations limit reached.');
  return { uid, charge, day: verdict.day, refunded: false };
}

/** Возврат списанного с гарантией идемпотентности: повторный вызов с той же резервацией ничего не делает. */
export async function refundCall(
  ctx: AiContext,
  resOrUid: CallReservation | string | null | undefined,
  maybeCharge?: ChargeTarget,
): Promise<void> {
  if (resOrUid == null) return;
  if (typeof resOrUid === 'object') {
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
  if (charge === 'user') {
    await ctx.refundDailyLimit(uid);
    return;
  }
  await ctx.refundBulkLimit(uid);
}

