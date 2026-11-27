// Дейлик 04.11 Н-1: обещание 0.11.4 «часы расходятся — стереть не предлагаем»
// держалось только на свежем замере по токену. Часы ушли, пока приложение было
// закрыто, — замер старый или нулевой, и человеку предлагалось стереть базу.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/react';
import { offerLostSessionWipe } from '../services/lostSessionWipe';
import { STORAGE_KEYS } from '../../../shared/constants/storageKeys';

vi.mock('../../../core/storage/localDb', () => ({ hasLocalDatabase: async () => true }));
vi.mock('../../../core/auth/supabaseAuthProvider', () => ({ CLOCK_SKEW_THRESHOLD_SEC: 300, getCurrentUser: () => null }));

const t = (key: string) => key;
const WIPE = 'auth_lost_session_wipe_hint';
const SIGN_IN = 'auth_clock_skew_sign_in_again';

function serverSays(ms: number | null): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', {
    headers: ms === null ? {} : { date: new Date(ms).toUTCString() },
  })));
}

async function offer(): Promise<string[]> {
  localStorage.setItem(STORAGE_KEYS.LOST_SESSION_UID, 'u_d35');
  const showToast = vi.fn();
  await offerLostSessionWipe(showToast, t, vi.fn(async () => false));
  await waitFor(() => expect(showToast).toHaveBeenCalled());
  return showToast.mock.calls.map(c => String(c[0]));
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('Н-1: перед предложением стереть данные сверяем часы с сервером', () => {
  it('часы спешат на 2 часа — про часы, стереть не предлагаем', async () => {
    serverSays(Date.now() - 2 * 3600_000);
    const toasts = await offer();
    expect(toasts.some(m => m.includes('auth_clock_skew_notice'))).toBe(true);
    expect(toasts.some(m => m.includes(SIGN_IN))).toBe(true);
    expect(toasts).not.toContain(WIPE);
    // DA-3 (дейлик 27.11): неверные часы — не решение человека; предложение вернётся,
    // когда часы поправят. Мутация: убрать rearm() у часов — красный.
    expect(localStorage.getItem(STORAGE_KEYS.LOST_SESSION_UID)).toBe('u_d35');
  });

  it('часы отстают на 2 часа — то же', async () => {
    serverSays(Date.now() + 2 * 3600_000);
    expect(await offer()).not.toContain(WIPE);
  });

  it('часы верные — сессию правда отозвали, предложение остаётся', async () => {
    serverSays(Date.now());
    expect(await offer()).toEqual([WIPE]);
  });

  it('«не знаю» (нет заголовка, нет сети) — не «часы верные» и не «спешат»: как раньше', async () => {
    serverSays(null);
    expect(await offer()).toEqual([WIPE]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await offer()).toEqual([WIPE]);
  });

  it('дейлик 05.11: чужой ответ с чужими часами — «не знаю», а не «часы спешат»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('нет', {
      status: 502,
      headers: { date: new Date(Date.now() - 2 * 3600_000).toUTCString() },
    })));
    expect(await offer()).toEqual([WIPE]);
  });
});
