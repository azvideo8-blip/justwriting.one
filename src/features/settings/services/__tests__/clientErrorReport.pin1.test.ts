// PIN-1 (дейлик 20.11): отправка отчёта об ошибках — отказ называется броском, вызывающий не рисует «отправлено».
// Мутации: убрать `throw` при !res.ok (кейс 1); убрать `throw` при пустом токене (кейс 2).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ getIdToken: vi.fn() }));
vi.mock('../../../../core/auth', () => ({ getIdToken: (...a: unknown[]) => h.getIdToken(...a) }));

import { sendClientErrorReport } from '../clientErrorReport';

const records = [{ action: 'marker', level: 'error' as const, time: 1 }];

describe('PIN-1: sendClientErrorReport', () => {
  beforeEach(() => { h.getIdToken.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('1. сервер ответил отказом (не ok) — бросок со статусом', async () => {
    h.getIdToken.mockResolvedValue('tok');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(sendClientErrorReport(records, '0.0.0')).rejects.toMatchObject({ status: 503 });
  });

  it('2. нет токена — AUTH_REQUIRED, запрос не уходит', async () => {
    h.getIdToken.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendClientErrorReport(records, '0.0.0')).rejects.toThrow('AUTH_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('КОНТРОЛЬ: ok — резолвится, в запросе не больше 50 записей', async () => {
    h.getIdToken.mockResolvedValue('tok');
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendClientErrorReport(Array.from({ length: 80 }, (_, i) => ({ action: `a${i}`, level: 'warning' as const, time: i })), '0.0.0');
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body) as { records: unknown[] };
    expect(body.records).toHaveLength(50);
  });
});
