// CK-3: выход из-за часов не должен выглядеть как «сессию отозвали — сотрите данные».
// Контекст: auth-js сверяет срок токена с `Date.now()` устройства
// (`node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:4123`); при часах,
// спешащих на 2 ч, часовой токен просрочен с рождения, обновления идут подряд
// (замер на стенде: 38 `token_refreshed` за 42 с — report-2026-11-02-gt.md), и
// первый сбой обновления рвёт сессию: `_removeSession` → SIGNED_OUT →
// `auth_session_signed_out` (supabaseAuthProvider.ts). Прежнее поведение S-28 на
// этом пути предлагало человеку стереть локальные данные — целые и его собственные.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOnAuthStateChange = vi.hoisted(() => vi.fn());
const storedSessionUid = vi.hoisted(() => ({ current: null as string | null }));
const setNotice = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../supabase/client', () => ({
  getSupabase: vi.fn(() => ({ auth: { onAuthStateChange: (...a: unknown[]) => mockOnAuthStateChange(...a) } })),
}));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../accountReload', () => ({
  reloadForAccountChange: reload,
  isAccountReloadPending: vi.fn(() => false),
  setAccountChangeNotice: setNotice,
  _resetAccountReloadForTesting: vi.fn(),
}));
vi.mock('../storedSession', () => ({ getStoredSessionUid: () => storedSessionUid.current }));

import { onAuthStateChange, _resetAuthStateForTesting } from '../supabaseAuthProvider';
import { reportError } from '../../../shared/errors/reportError';

const UID = 'u-clock-out';

function tokenWithIat(iat: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat, exp: iat + 3600, sub: UID })}.sig`;
}

const handlers: Array<(event: string, s: unknown) => void> = [];

function session(accessToken: string): unknown {
  return {
    access_token: accessToken,
    user: { id: UID, email: `${UID}@example.com`, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-01-01T00:00:00Z' },
  };
}

function emit(event: string, accessToken?: string): void {
  for (const h of handlers) h(event, accessToken ? session(accessToken) : null);
}

beforeEach(() => {
  handlers.length = 0;
  mockOnAuthStateChange.mockImplementation((h: (e: string, s: unknown) => void) => { handlers.push(h); return { data: { subscription: null } }; });
  setNotice.mockReset();
  vi.mocked(reportError).mockReset();
  reload.mockResolvedValue(undefined as never);
  storedSessionUid.current = null;
  localStorage.clear();
  _resetAuthStateForTesting();
});

/** Вход с часами, спешащими на `skew` секунд, затем нечаянный выход. */
function signInThenSignOut(skewSec: number): void {
  onAuthStateChange(() => {});
  emit('SIGNED_IN', tokenWithIat(Math.floor(Date.now() / 1000) - skewSec));
  emit('SIGNED_OUT');
}

describe('CK-3: нечаянный выход при известном расхождении часов', () => {
  it('часы спешат на 2 ч — notice `clock_skew`, а не `lost_session`', () => {
    signInThenSignOut(7_200);

    expect(setNotice).toHaveBeenCalledWith('clock_skew', UID);
    expect(setNotice.mock.calls.some(c => c[0] === 'lost_session')).toBe(false);
  });

  it('предложение стереть данные НЕ остаётся в хранилище (ключ lost_session не пишется)', () => {
    signInThenSignOut(7_200);

    const written = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '')
      .filter(k => /lost_session/i.test(k));
    expect(written, `ключи стирания: ${JSON.stringify(written)}`).toEqual([]);
  });

  it('диагностика называет причину: в контексте есть skewSec', () => {
    signInThenSignOut(7_200);

    const calls = vi.mocked(reportError).mock.calls;
    const call = calls.find(c => String((c[1] as Record<string, unknown>)?.['action']) === 'auth_session_signed_out');
    expect(call, `отчёт о нечаянном выходе, вызовов: ${calls.length}`).toBeDefined();
    expect(Math.abs(Number((call![1] as Record<string, unknown>)['skewSec']))).toBeGreaterThanOrEqual(300);
  });

  it('расхождения нет — поведение S-28 как раньше (предложение стирания остаётся)', () => {
    onAuthStateChange(() => {});
    emit('SIGNED_IN', tokenWithIat(Math.floor(Date.now() / 1000) - 5));
    emit('SIGNED_OUT');

    expect(setNotice).toHaveBeenCalledWith('lost_session');
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '')
      .some(k => /lost_session/i.test(k))).toBe(true);
    const call = vi.mocked(reportError).mock.calls.find(c => String((c[1] as Record<string, unknown>)?.['action']) === 'auth_session_signed_out');
    // причина в диагностике есть всегда, когда токен прочитался; решает порог:
    expect(Math.abs(Number((call![1] as Record<string, unknown>)['skewSec']))).toBeLessThan(300);
  });

  it('расхождение меньше порога (240 с) — тоже прежний путь', () => {
    signInThenSignOut(240);
    expect(setNotice).toHaveBeenCalledWith('lost_session');
  });

  it('часы отстают — тоже расхождение, стирать не предлагаем', () => {
    signInThenSignOut(-4_000);
    expect(setNotice).toHaveBeenCalledWith('clock_skew', UID);
  });

  it('битый токен — «не знаю», и молча менять поведение S-28 не будем', () => {
    onAuthStateChange(() => {});
    emit('SIGNED_IN', 'не-токен');
    emit('SIGNED_OUT');
    expect(setNotice).toHaveBeenCalledWith('lost_session');
  });
});
