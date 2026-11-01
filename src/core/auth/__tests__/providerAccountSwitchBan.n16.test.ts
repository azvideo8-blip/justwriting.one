// N1-6: запрет провайдера менять аккаунт без перезагрузки страницы
// (`supabaseAuthProvider.ts:74-77` — зеркало, `:105` — слушатели экрана). До этой
// правки теста на него не было: `grep -rn "accountChanges" src/core/auth/__tests__/`
// — пусто, а `accountReload.test.ts` проверяет сам модуль перезагрузки, не
// провайдера.
// Смысл запрета: память вкладки принадлежит прежнему человеку, и фоновая работа
// прежнего обязана писать в ЕГО базу, а не в базу нового (I3 черновика, D-04/DEEP-1).
// Мутация: убрать раннее возвращение в зеркале и в `onAuthStateChange` → оба
// кейса красные (слушатель получает нового человека, `getCurrentUser()`
// переключается без перезагрузки).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOnAuthStateChange = vi.hoisted(() => vi.fn());
const reloadForAccountChange = vi.hoisted(() => vi.fn(async () => {}));
const isAccountReloadPending = vi.hoisted(() => vi.fn(() => false));

vi.mock('../../supabase/client', () => ({
  getSupabase: vi.fn(() => ({
    auth: { onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args) },
  })),
}));
vi.mock('../../shared/errors/reportError', () => ({ reportError: vi.fn() }));
vi.mock('../accountReload', () => ({
  reloadForAccountChange,
  isAccountReloadPending,
  setAccountChangeNotice: vi.fn(),
  _resetAccountReloadForTesting: vi.fn(),
}));

import { onAuthStateChange, getCurrentUser, _resetAuthStateForTesting } from '../supabaseAuthProvider';
import type { AppUser } from '../types';

const handlers: Array<(event: string, session: unknown) => void> = [];

function userPayload(uid: string): unknown {
  return {
    user: {
      id: uid, email: `${uid}@example.com`, user_metadata: {},
      created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-01-01T00:00:00Z',
    },
  };
}

function emit(event: string, uid: string | null): void {
  const session = uid === null ? null : userPayload(uid);
  for (const handler of [...handlers]) handler(event, session);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  handlers.length = 0;
  mockOnAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
    handlers.push(cb);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  reloadForAccountChange.mockImplementation(async () => {});
  isAccountReloadPending.mockReturnValue(false);
  _resetAuthStateForTesting();
  // Подписка ленивая (`ensureSubscribed`), поэтому зеркало регистрируется
  // первым обращением — как в приложении.
  getCurrentUser();
});

describe('N1-6: смена аккаунта без перезагрузки страницы запрещена', () => {
  it('слушатели нового uid ничего не получают, а перезагрузка запрошена', async () => {
    emit('SIGNED_IN', 'u_a'); // вход первого человека
    const seen: Array<AppUser | null> = [];
    onAuthStateChange(u => seen.push(u));
    emit('SIGNED_IN', 'u_a'); // тот же человек — событие доходит

    expect(seen.map(u => u?.uid), 'первый вход не дошёл до экрана').toEqual(['u_a']);
    expect(reloadForAccountChange).not.toHaveBeenCalled();

    emit('SIGNED_IN', 'u_b'); // смена аккаунта в этой же вкладке

    expect(reloadForAccountChange, 'смена аккаунта не запрошила перезагрузку').toHaveBeenCalledTimes(1);
    expect(seen.map(u => u?.uid), 'экран получил нового человека без перезагрузки').toEqual(['u_a']);
    expect(getCurrentUser()?.uid, 'провайдер переключился на нового человека').toBe('u_a');
  });

  it('зеркало getCurrentUser() тоже остаётся у прежнего аккаунта', () => {
    emit('SIGNED_IN', 'u_c');
    expect(getCurrentUser()?.uid).toBe('u_c');

    emit('USER_UPDATED', 'u_d');

    expect(getCurrentUser()?.uid, 'фоновая работа прежнего поехала бы в базу нового').toBe('u_c');
    expect(reloadForAccountChange).toHaveBeenCalledTimes(1);
  });

  it('контроль: вход из гостя (null → кто-то) сменой аккаунта не считается', () => {
    onAuthStateChange(vi.fn());

    emit('SIGNED_IN', 'u_e');

    expect(getCurrentUser()?.uid).toBe('u_e');
    expect(reloadForAccountChange, 'вход из гостя вызвал перезагрузку').not.toHaveBeenCalled();
  });
});
