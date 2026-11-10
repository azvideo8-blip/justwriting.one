// S2-4: ответ sync_push разбирается строго — «нет ответа» не читается как «легло».
// Мутации: убрать сверку длины → красный «короче пачки»; убрать сверку статуса →
// красный «неизвестный статус».
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../../supabase/client', () => ({ getSupabase: () => ({ rpc }) }));

import { syncPush } from '../syncPush';

const item = { table: 'documents', op: 'delta', uuid: 'd', op_id: 'o', sessions: 1, duration: 1, words: 1 } as const;

describe('S2-4: провайдер syncPush', () => {
  beforeEach(() => rpc.mockReset());

  it('ответ по элементам отдаётся как есть', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'ok', rev: 5 }], error: null });
    expect(await syncPush([item])).toEqual([{ status: 'ok', rev: 5 }]);
    expect(rpc).toHaveBeenCalledWith('sync_push', { items: [item] });
  });

  it('ответ короче пачки — исключение', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(syncPush([item])).rejects.toThrow(/response of/);
  });

  it('null вместо ответа — исключение', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(syncPush([item])).rejects.toThrow();
  });

  it('неизвестный статус — исключение', async () => {
    rpc.mockResolvedValue({ data: [{ status: 'maybe' }], error: null });
    await expect(syncPush([item])).rejects.toThrow(/unknown response/);
  });

  it('ошибка сервера пробрасывается: старого пути записи больше нет', async () => {
    const err = { code: 'PGRST202', message: 'not found' };
    rpc.mockResolvedValue({ data: null, error: err });
    await expect(syncPush([item])).rejects.toBe(err);
  });

  it('пустая пачка — без запроса', async () => {
    expect(await syncPush([])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
