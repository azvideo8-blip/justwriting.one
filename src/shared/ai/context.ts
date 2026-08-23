// AG-AIONE-1: единая копия контракта ИИ-контекста (была в api/ai/context.ts
// и functions/src/shared/aiContext.ts; обе ушли — осталась эта).
// Реализация — postgresAiContext в api/postgresAiContext.ts.

export interface GlobalReservation {
  date: string;
  shardId: string;
  allowance: number;
  refunded?: boolean;
}

export interface AiContext {
  recordUsage(
    uid: string,
    tokensIn: number,
    tokensOut: number,
    opts?: { model?: string; fn?: string },
    res?: GlobalReservation | null,
  ): Promise<void>;
  tryReserveGlobalRequest(allowance?: number): Promise<GlobalReservation | null>;
  refundGlobalRequest(res: GlobalReservation | null | undefined): Promise<void>;
  /** Returns true if the call is allowed (limit NOT exceeded); false to reject.
   *  `day` is the day the charge landed on — a refund must target it, not the
   *  day the failure happens to fall on (cross-midnight requests). */
  checkDailyLimit(uid: string, reasoning?: boolean): Promise<LimitVerdict>;
  /** chargedDay: the day the charge landed on. Omitting it falls back to
   *  today() — legacy shape kept for the string-form refundCall path only;
   *  new code must always thread the day through. */
  refundDailyLimit(uid: string, chargedDay?: string): Promise<void>;
  getDailyLimitCount(uid: string): Promise<{ used: number; date: string }>;
  getUserDailyLimit(uid: string): Promise<number>;
  isAdmin(uid: string): Promise<boolean>;
  /** Bulk (background) limit — separate from the chat daily limit. */
  checkAndIncrementBulkLimit(uid: string): Promise<LimitVerdict>;
  refundBulkLimit(uid: string, chargedDay?: string): Promise<void>;
  /** Combined chat limit + cooldown check; increments on success. */
  checkAndIncrementLimit(
    uid: string,
    reasoning?: boolean,
  ): Promise<{ ok: true; day: string } | 'DAILY_LIMIT' | 'RATE_LIMIT'>;
}

/** Result of a successful charge: the caller keeps `day` and passes it to the
 *  matching refund, so a request charged at 23:58 refunds the right row even
 *  if it fails after midnight. */
export interface LimitVerdict {
  ok: boolean;
  day: string;
}

/** Error thrown by .logic.ts files in place of HttpsError. */
export class AiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
