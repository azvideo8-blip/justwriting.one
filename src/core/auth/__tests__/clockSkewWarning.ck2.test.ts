// CK-2: предупреждение про часы — один тост на вкладку, не на каждое обновление.
// При спешащих часах auth-js обновляет токен десятки раз подряд (замер на s38:
// 38 `token_refreshed` за 42 с), поэтому «показывать на каждом TOKEN_REFRESHED»
// превратило бы экран в мелькание.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOnAuthStateChange = vi.hoisted(() => vi.fn());
const storedSessionUid = vi.hoisted(() => ({ current: null as string | null }));

vi.mock('../../supabase/client', () => ({
  getSupabase: vi.fn(() => ({ auth: { onAuthStateChange: (...a: unknown[]) => mockOnAuthStateChange(...a) } })),
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../accountReload', () => ({
  reloadForAccountChange: vi.fn(async () => {}),
  isAccountReloadPending: vi.fn(() => false),
  setAccountChangeNotice: vi.fn(),
  _resetAccountReloadForTesting: vi.fn(),
}));
vi.mock('../storedSession', () => ({ getStoredSessionUid: () => storedSessionUid.current }));

import { onAuthStateChange, takeClockSkewWarning, _resetAuthStateForTesting, getClockSkewSec } from '../supabaseAuthProvider';
import { clockSkewParts } from '../../../features/auth/services/clockSkewToast';

const UID = 'u-warn';
const handlers: Array<(event: string, s: unknown) => void> = [];

function tokenWithIat(iat: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat, exp: iat + 3600, sub: UID })}.sig`;
}

/** Вход с расхождением в `skew` секунд. */
function signInWithSkew(skew: number): void {
  onAuthStateChange(() => {});
  for (const h of handlers) h('SIGNED_IN', { access_token: tokenWithIat(Math.floor(Date.now() / 1000) - skew), user: { id: UID, email: 'a@b.c', user_metadata: {} } });
}

beforeEach(() => {
  handlers.length = 0;
  mockOnAuthStateChange.mockImplementation((h: (e: string, s: unknown) => void) => { handlers.push(h); return { data: { subscription: null } }; });
  storedSessionUid.current = null;
  localStorage.clear();
  _resetAuthStateForTesting();
});

describe('CK-2: тост про часы', () => {
  it('расхождение 2 ч — разрешён ровно один раз на вкладку', () => {
    signInWithSkew(7_200);
    expect(takeClockSkewWarning(UID)).toBe(true);
    expect(takeClockSkewWarning(UID)).toBe(false);
    expect(takeClockSkewWarning(UID)).toBe(false);
  });

  it('расхождения нет — молчим', () => {
    signInWithSkew(3);
    expect(takeClockSkewWarning(UID)).toBe(false);
  });

  it('меньше порога — молчим, даже если замер есть', () => {
    signInWithSkew(240);
    expect(getClockSkewSec(UID)).not.toBeNull();
    expect(takeClockSkewWarning(UID)).toBe(false);
  });

  it('расхождение неизвестно (битый токен) — молчим, а не пугаем', () => {
    onAuthStateChange(() => {});
    for (const h of handlers) h('SIGNED_IN', { access_token: 'не-токен', user: { id: UID, email: 'a@b.c', user_metadata: {} } });
    expect(takeClockSkewWarning(UID)).toBe(false);
  });

  it('новая вкладка (сброс состояния модуля) — предупреждение снова разрешено', () => {
    signInWithSkew(7_200);
    expect(takeClockSkewWarning(UID)).toBe(true);
    _resetAuthStateForTesting();
    signInWithSkew(7_200);
    expect(takeClockSkewWarning(UID)).toBe(true);
  });

  it('единицы для текста: 2 ч, 15 мин, 40 мин; часы — от 2 часов', () => {
    expect(clockSkewParts(7_200)).toEqual({ unit: 'hours', value: 2 });
    expect(clockSkewParts(900)).toEqual({ unit: 'minutes', value: 15 });
    expect(clockSkewParts(90_000)).toEqual({ unit: 'hours', value: 25 });   // 25 часов — это часы, не 1500 минут
    expect(clockSkewParts(-2_400)).toEqual({ unit: 'minutes', value: 40 });
    expect(clockSkewParts(3_600)).toEqual({ unit: 'minutes', value: 60 });
    expect(clockSkewParts(null)).toBeNull();
  });
});
