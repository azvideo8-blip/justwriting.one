// DT-2 (дейлик 04.11, подозрение ревьюера): `getClockSkewSec` сначала отдаёт
// значение памяти модуля и не сверяет его с переданным uid. Замер Аккаунта А —
// «расхождение часов» Аккаунта Б или гостя (`takeClockSkewWarning(null)` в
// AppShell.tsx:122, окно — до перезагрузки вкладки по смене аккаунта).
// Мутация: вернуть в supabaseAuthProvider чтение `clockSkew` без сверки uid →
// красные оба кейса про чужого владельца.
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

import {
  onAuthStateChange,
  getClockSkewSec,
  isClockSkewed,
  takeClockSkewWarning,
  _resetAuthStateForTesting,
} from '../supabaseAuthProvider';

const UID_A = 'u-skew-a';
const UID_B = 'u-skew-b';

function tokenWithIat(iat: number, sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat, exp: iat + 3600, sub })}.sig`;
}

const handlers: Array<(event: string, s: unknown) => void> = [];

function subscribe(): void {
  onAuthStateChange(() => {});
}

/** Событие с токеном этого uid — как в проде: session.user.id задаёт владельца замера. */
function emitSignedIn(uid: string, skewSec: number): void {
  const iat = Math.floor(Date.now() / 1000) - skewSec;
  const session = {
    access_token: tokenWithIat(iat, uid),
    user: { id: uid, email: `${uid}@example.com`, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-01-01T00:00:00Z' },
  };
  for (const h of handlers) h('SIGNED_IN', session);
}

beforeEach(() => {
  handlers.length = 0;
  mockOnAuthStateChange.mockImplementation((h: (event: string, s: unknown) => void) => { handlers.push(h); return { data: { subscription: null } }; });
  storedSessionUid.current = null;
  localStorage.clear();
  _resetAuthStateForTesting();
});

describe('DT-2: расхождение часов принадлежит тому, у кого его измерили', () => {
  it('замер А не становится расхождением Б (память модуля), в т. ч. когда у Б записи нет', () => {
    subscribe();
    emitSignedIn(UID_A, 7_200);
    expect(getClockSkewSec(UID_A)).toBeCloseTo(7_200, -1);
    expect(isClockSkewed(UID_B)).toBe(false);
    expect(getClockSkewSec(UID_B)).toBeNull();
    expect(takeClockSkewWarning(UID_B)).toBe(false);
  });

  it('замер А не показывается гостю (uid = null) и не даёт тост', () => {
    subscribe();
    emitSignedIn(UID_A, 7_200);
    expect(getClockSkewSec(null)).toBeNull();
    expect(isClockSkewed(null)).toBe(false);
    expect(takeClockSkewWarning(null)).toBe(false);
  });

  // Зелёный контроль: свёрка по uid не отнимает у аккаунта его собственный замер
  // из памяти и из localStorage — иначе DT-2 ломает CK-1/CK-2.
  it('свой замер остаётся: память для А, запись в localStorage — для Б', () => {
    localStorage.setItem(`jw_clock_skew_${UID_B}`, JSON.stringify({ s: 900, at: Date.now() - 60_000 }));
    subscribe();
    emitSignedIn(UID_A, 7_200);
    expect(getClockSkewSec(UID_A)).toBeCloseTo(7_200, -1);
    expect(getClockSkewSec(UID_B)).toBeCloseTo(900, -1);
    expect(isClockSkewed(UID_B)).toBe(true);
  });
});
