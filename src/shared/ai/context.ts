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
  tryReserveGlobalRequest(allowance?: number): Promise<GlobalReservation | { error: 'unavailable' } | null>;
  refundGlobalRequest(res: GlobalReservation | { error: 'unavailable' } | null | undefined): Promise<void>;
  /** Returns true if the call is allowed (limit NOT exceeded); false to reject.
   *  `day` is the day the charge landed on — a refund must target it, not the
   *  day the failure happens to fall on (cross-midnight requests). */
  checkDailyLimit(uid: string, reasoning?: boolean): Promise<LimitVerdict>;
  /** chargedDay: the day the charge landed on. DEEP-9: required so a request charged
   *  at 23:58 and failing after midnight refunds the right day row. */
  refundDailyLimit(uid: string, chargedDay: string, kind?: 'chat' | 'reasoning' | string): Promise<void>;
  getDailyLimitCount(uid: string): Promise<{ used: number; reasoningUsed?: number; date: string }>;
  getUserDailyLimit(uid: string): Promise<number>;
  isAdmin(uid: string): Promise<boolean>;
  /** DY9-9: админ сбрасывает суточные счётчики чата и рассуждений человека (сегодня).
   *  DY10-1: со следом в admin_actions и почасовым бюджетом; 'budget' — бюджет исчерпан,
   *  'busy' — параллельный сброс того же админа. */
  resetDailyLimit(adminUid: string, targetUid: string): Promise<'ok' | 'budget' | 'busy'>;
  /** Bulk (background) limit — separate from the chat daily limit.
   *  AUD-18: also enforces a per-interval cooldown keyed (uid, endpoint);
   *  returns 'RATE_LIMIT' when the interval has not elapsed. */
  checkAndIncrementBulkLimit(uid: string, endpoint?: string, kind?: string): Promise<LimitVerdict | 'RATE_LIMIT'>;
  refundBulkLimit(uid: string, chargedDay: string, kind?: string): Promise<void>;
  /** Combined chat limit + cooldown check; increments on success. */
  checkAndIncrementLimit(
    uid: string,
    reasoning?: boolean,
  ): Promise<{ ok: true; day: string } | 'DAILY_LIMIT' | 'REASONING_LIMIT' | 'RATE_LIMIT' | { error: 'RATE_LIMIT'; retryAfterSec: number } | 'UNAVAILABLE' | 'UNAUTHORIZED'>;
  /** Reset 10-second chat cooldown after upstream provider failure (F-8). */
  resetCooldown?(uid: string): Promise<void>;
  /** Согласие на обработку специальных категорий (AUD-2). Серверный гейт:
   *  клиентский обходится прямым POST /api/chat. */
  getAiConsent(uid: string): Promise<{ granted: boolean; error?: 'unavailable' }>;
  /** Согласие на векторную индексацию — для embedDocument. */
  getIndexingConsent(uid: string): Promise<{ granted: boolean; error?: 'unavailable' }>;
}

/** Result of a successful charge: the caller keeps `day` and passes it to the
 *  matching refund, so a request charged at 23:58 refunds the right row even
 *  if it fails after midnight. */
export interface LimitVerdict {
  ok: boolean;
  day: string;
  reason?: 'unavailable' | 'unauthorized' | 'limit_exceeded';
}

/** Error thrown by .logic.ts files in place of HttpsError. */
export class AiError extends Error {
  public readonly retryAfterSec?: number | undefined;

  constructor(
    public readonly code: string,
    message: string,
    retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'AiError';
    if (retryAfterSec !== undefined) {
      this.retryAfterSec = retryAfterSec;
    }
  }
}
