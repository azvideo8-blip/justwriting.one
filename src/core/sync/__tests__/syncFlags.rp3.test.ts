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

import { syncPullByRevEnabled, syncPushRpcEnabled, markSyncPushUnavailable, resetSyncFlagsForTests } from '../syncFlags';

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

// S2-4: флаг записи через sync_push — свой кэш, а «функции нет» (PGRST202) выключает
// новый путь до конца сессии. Мутации: общий кэш на оба флага → красный «два флага
// не путаются»; забыть markSyncPushUnavailable → красный «после PGRST202 — старый путь».
describe('S2-4: флаг sync_push_rpc', () => {
  beforeEach(() => { rpc.mockReset(); resetSyncFlagsForTests(); });

  it('два флага не путаются: у каждого свой ответ сервера', async () => {
    rpc.mockImplementation(async (_fn: string, args: { flag: string }) => ({ data: args.flag === 'sync_pull_by_rev', error: null }));
    expect(await syncPullByRevEnabled('u1')).toBe(true);
    expect(await syncPushRpcEnabled('u1')).toBe(false);
    expect(rpc).toHaveBeenCalledWith('feature_enabled', { flag: 'sync_push_rpc' });
  });

  it('сбой чтения — старый путь', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await syncPushRpcEnabled('u1')).toBe(false);
  });

  it('после PGRST202 — старый путь до конца сессии, без вопроса серверу', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await syncPushRpcEnabled('u1')).toBe(true);
    markSyncPushUnavailable('u1');
    expect(await syncPushRpcEnabled('u1')).toBe(false);
    expect(await syncPushRpcEnabled('u2')).toBe(true);
  });
});
