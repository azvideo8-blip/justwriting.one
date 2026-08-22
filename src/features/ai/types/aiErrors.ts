/**
 * Canonical AI error code union shared across AI services, transport, and UI hooks.
 * Wire values match the server and transport error codes byte-for-byte.
 */
export type AIErrorCode =
  | 'AUTH_REQUIRED'
  | 'AI_CONSENT_REQUIRED'
  | 'DAILY_LIMIT'
  | 'RATE_LIMIT'
  | 'GLOBAL_LIMIT'
  | 'TOO_LONG'
  | 'UPSTREAM'
  | 'SERVER_ERROR'
  | 'NETWORK'
  | 'MISCONFIGURED'
  | 'EMPTY_RESPONSE'
  | 'ABORTED';

export function assertNever(x: never): never {
  throw new Error(`unhandled: ${String(x)}`);
}
