import { describe, it, expect } from 'vitest';
import { extractErrorCode } from '../aiChatTransport';

// AUDIT-part3 2: контракт кодов ошибок /api/chat. Клиент матчит ровно эти
// двенадцать кодов (useAIChat); extractErrorCode обязан возвращать их
// ИЗ ОБОИХ форм сервера — legacy {error:'CODE'} и новую {error:{code,message}}.

const CONTRACT_CODES = [
  'ABORTED', 'RATE_LIMIT', 'DAILY_LIMIT', 'GLOBAL_LIMIT', 'AUTH_REQUIRED',
  'AI_CONSENT_REQUIRED', 'EMPTY_RESPONSE', 'UPSTREAM', 'TOO_LONG', 'NETWORK',
  'MISCONFIGURED', 'SERVER_ERROR',
] as const;

describe('extractErrorCode dual-form contract (AUDIT-part3 2)', () => {
  it.each(CONTRACT_CODES)('parses %s from both server forms', (code) => {
    expect(extractErrorCode({ error: code })).toBe(code);
    expect(extractErrorCode({ error: { code, message: 'human text' } })).toBe(code);
  });

  it('returns undefined for non-error bodies and garbage', () => {
    expect(extractErrorCode(undefined)).toBeUndefined();
    expect(extractErrorCode(null)).toBeUndefined();
    expect(extractErrorCode({})).toBeUndefined();
    expect(extractErrorCode({ error: 42 })).toBeUndefined();
    expect(extractErrorCode({ error: { code: 42 } })).toBeUndefined();
  });

  it('prefers the code field and ignores non-string codes', () => {
    expect(extractErrorCode({ error: { code: 'X', message: 'm' } })).toBe('X');
    expect(extractErrorCode({ error: { message: 'only message' } })).toBeUndefined();
  });
});
