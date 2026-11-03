// Ревью CK-1 (03.11): возврат на вкладку шлёт SIGNED_IN со старым токеном — не замер.
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

import { onAuthStateChange, isClockSkewed, _resetAuthStateForTesting } from '../supabaseAuthProvider';

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

describe('ревью CK-1: SIGNED_IN при возврате на вкладку — старый токен', () => {
  it('перезагрузка, затем возврат на вкладку через 20 мин — тот же старый токен не даёт расхождения', () => {
    storedSessionUid.current = UID;
    const oldIat = Math.floor(Date.now() / 1000) - 1_200;
    subscribe();
    emit('SIGNED_IN', tokenWithIat(oldIat));
    emit('INITIAL_SESSION', tokenWithIat(oldIat));
    emit('SIGNED_IN', tokenWithIat(oldIat)); // _onVisibilityChanged → _recoverAndRefresh :4167
    expect(isClockSkewed(UID)).toBe(false);
  });
  it('вход, через 20 мин возврат на вкладку — не расхождение', () => {
    const iat = Math.floor(Date.now() / 1000);
    subscribe();
    emit('INITIAL_SESSION');
    emit('SIGNED_IN', tokenWithIat(iat));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 1_200_000);
    emit('SIGNED_IN', tokenWithIat(iat));
    vi.useRealTimers();
    expect(isClockSkewed(UID)).toBe(false);
  });
});
