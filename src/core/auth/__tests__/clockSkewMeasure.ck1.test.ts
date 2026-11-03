// CK-1: замер расхождения часов устройства и сервера.
// Правила взяты не из головы, а из пробы на живом стенде (auth-js 2.118,
// `gt-logs/ck-probe.mjs`, 03.11):
//   вход                            → INITIAL_SESSION (без токена), SIGNED_IN (с токеном)
//   перезагрузка с сохранённой сессией → SIGNED_IN (с токеном), INITIAL_SESSION (с токеном)
// Первый SIGNED_IN поэтому НЕ отличает вход от восстановления: при перезагрузке в
// нём старый токен, и замер по нему дал бы ложное расхождение на время жизни
// токена (час). Отличаем по снимку хранилища на момент подписки.
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

import { onAuthStateChange, getClockSkewSec, isClockSkewed, _resetAuthStateForTesting, CLOCK_SKEW_THRESHOLD_SEC } from '../supabaseAuthProvider';

const UID = 'u-clock';

function tokenWithIat(iat: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat, exp: iat + 3600, sub: UID })}.sig`;
}

function session(accessToken: string): unknown {
  return {
    access_token: accessToken,
    user: { id: UID, email: `${UID}@example.com`, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-01-01T00:00:00Z' },
  };
}

const handlers: Array<(event: string, s: unknown) => void> = [];

function subscribe(): void {
  onAuthStateChange(() => {});
}

function emit(event: string, accessToken?: string): void {
  // Обработчики НЕ удаляем: провайдер подписывается один раз, и второе событие
  // (TOKEN_REFRESHED, второй битый токен) должно дойти до того же слушателя.
  for (const h of handlers) h(event, accessToken ? session(accessToken) : null);
}

beforeEach(() => {
  handlers.length = 0;
  mockOnAuthStateChange.mockImplementation((h: (event: string, s: unknown) => void) => { handlers.push(h); return { data: { subscription: null } }; });
  storedSessionUid.current = null;
  localStorage.clear();
  _resetAuthStateForTesting();
});

describe('CK-1: расхождение часов', () => {
  it('свежий токен после входа — расхождение посчитано и запомнено', () => {
    const iat = Math.floor(Date.now() / 1000) - 7_200; // часы спешат на 2 ч
    subscribe();
    emit('SIGNED_IN', tokenWithIat(iat));

    expect(getClockSkewSec(UID)).toBeCloseTo(7_200, -1);
    expect(isClockSkewed(UID)).toBe(true);
    expect(localStorage.getItem(`jw_clock_skew_${UID}`)).not.toBeNull();
  });

  it('токен из хранилища при загрузке — НЕ считается (иначе врал бы на час жизни токена)', () => {
    storedSessionUid.current = UID;                 // сессия уже была в хранилище
    const oldIat = Math.floor(Date.now() / 1000) - 3_000;
    subscribe();
    emit('SIGNED_IN', tokenWithIat(oldIat));        // auth-js шлёт его и при восстановлении
    emit('INITIAL_SESSION', tokenWithIat(oldIat));

    expect(getClockSkewSec(UID)).toBeNull();
    expect(isClockSkewed(UID)).toBe(false);
    expect(localStorage.getItem(`jw_clock_skew_${UID}`)).toBeNull();
  });

  it('TOKEN_REFRESHED — токен всегда свежий, считаем даже после восстановления', () => {
    storedSessionUid.current = UID;
    subscribe();
    emit('SIGNED_IN', tokenWithIat(Math.floor(Date.now() / 1000) - 3_000));  // восстановление: не считаем
    emit('TOKEN_REFRESHED', tokenWithIat(Math.floor(Date.now() / 1000) - 5_400));

    expect(getClockSkewSec(UID)).toBeCloseTo(5_400, -1);
  });

  it('битый токен — «не знаю», а не ноль и не ошибка', () => {
    subscribe();
    emit('SIGNED_IN', 'не-токен');
    expect(getClockSkewSec(UID)).toBeNull();
    expect(isClockSkewed(UID)).toBe(false);

    emit('SIGNED_IN', 'a..');
    expect(getClockSkewSec(UID)).toBeNull();
  });

  it('значение переживает перезагрузку страницы: читается из localStorage', () => {
    subscribe();
    emit('SIGNED_IN', tokenWithIat(Math.floor(Date.now() / 1000) - 600));
    const written = localStorage.getItem(`jw_clock_skew_${UID}`);
    expect(written).not.toBeNull();

    // Новая вкладка: память модуля пуста, есть только запись аккаунта.
    _resetAuthStateForTesting();
    expect(getClockSkewSec(UID)).toBeCloseTo((JSON.parse(written!) as { s: number }).s, -1);
    expect(isClockSkewed(UID)).toBe(true);
  });

  it('ревью CK: замер старше 6 ч не объясняет выход — «не знаю»', () => {
    localStorage.setItem(`jw_clock_skew_${UID}`, JSON.stringify({ s: 7200, at: Date.now() - 7 * 60 * 60 * 1000 }));
    expect(getClockSkewSec(UID)).toBeNull();
    expect(isClockSkewed(UID)).toBe(false);
    localStorage.setItem(`jw_clock_skew_${UID}`, JSON.stringify({ s: 7200, at: Date.now() - 60_000 }));
    expect(isClockSkewed(UID)).toBe(true);
  });

  it(`порог — одна константа: ${CLOCK_SKEW_THRESHOLD_SEC} с, меньше — не «расхождение»`, () => {
    expect(CLOCK_SKEW_THRESHOLD_SEC).toBe(300);
    subscribe();
    emit('SIGNED_IN', tokenWithIat(Math.floor(Date.now() / 1000) - 240));
    expect(getClockSkewSec(UID)).toBeCloseTo(240, -1);   // измерено
    expect(isClockSkewed(UID)).toBe(false);              // но не порог
  });

  it('часы отстают — тоже расхождение (модуль по модулю)', () => {
    subscribe();
    emit('SIGNED_IN', tokenWithIat(Math.floor(Date.now() / 1000) + 4_000));
    expect(isClockSkewed(UID)).toBe(true);
    expect(getClockSkewSec(UID)).toBeLessThan(0);
  });
});
