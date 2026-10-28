// RP-3: флаг нового забора — с сервера (`feature_enabled`, миграция 0046), а не
// константа. Сбой чтения и сервер без функции — код по умолчанию (старый путь),
// а не «включено». Ответ кэшируется на сессию и привязан к uid.
// Мутации: ошибка → true (красный «сбой = старый путь»); кэш без сверки uid
// (красный «другой пользователь спрашивает заново»); кэш сбоя (красный «после
// сбоя спрашивает снова» — ревью 0.11.0).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../supabase/client', () => ({ getSupabase: () => ({ rpc }) }));
vi.mock('../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { syncPullByRevEnabled, resetSyncFlagsForTests } from '../syncFlags';

describe('RP-3: флаг sync_pull_by_rev с сервера', () => {
  beforeEach(() => { rpc.mockReset(); resetSyncFlagsForTests(); });

  it('сервер сказал «да» — новый путь; спрашивается флаг по имени', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await syncPullByRevEnabled('u1')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('feature_enabled', { flag: 'sync_pull_by_rev' });
  });

  it('сервер без 0046 (ошибка RPC) — старый путь', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    expect(await syncPullByRevEnabled('u1')).toBe(false);
  });

  it('сеть упала — старый путь', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await syncPullByRevEnabled('u1')).toBe(false);
  });

  it('ответ кэшируется на сессию, другой пользователь спрашивает заново', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await syncPullByRevEnabled('u1');
    await syncPullByRevEnabled('u1');
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await syncPullByRevEnabled('u2')).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('сбой не кэшируется: после него следующий забор спрашивает снова', async () => {
    rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await syncPullByRevEnabled('u1')).toBe(false);
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await syncPullByRevEnabled('u1')).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
