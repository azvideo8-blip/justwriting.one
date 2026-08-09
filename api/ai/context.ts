// functions/src/shared/aiContext.ts
// Shared context interface for AI handlers — one implementation per runtime.
// firestoreAiContext (functions/): Firestore-backed, used by production Cloud Functions.
// postgresAiContext  (api/):        Postgres-backed, used by the VPS service.

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
  /** Returns true if the call is allowed (limit NOT exceeded); false to reject. */
  checkDailyLimit(uid: string, reasoning?: boolean): Promise<boolean>;
  refundDailyLimit(uid: string): Promise<void>;
  getDailyLimitCount(uid: string): Promise<{ used: number; date: string }>;
  getUserDailyLimit(uid: string): Promise<number>;
  isAdmin(uid: string): Promise<boolean>;
  /** Bulk (background) limit — separate from the chat daily limit. */
  checkAndIncrementBulkLimit(uid: string): Promise<boolean>;
  refundBulkLimit(uid: string): Promise<void>;
  /** Combined chat limit + cooldown check; increments on success. */
  checkAndIncrementLimit(uid: string, reasoning?: boolean): Promise<true | 'DAILY_LIMIT' | 'RATE_LIMIT'>;
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
