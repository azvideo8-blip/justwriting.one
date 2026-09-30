import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createCallReservation } from '../../src/shared/ai/aiPolicy.js';
import type { AiContext, GlobalReservation } from '../../src/shared/ai/context.js';

// R4-053: защёлки reservation не должны срабатывать до успешного await —
// иначе один сбой БД навсегда блокировал повтор и резерв зависал в ai_global_daily.
describe('R4-053: reservation latches survive a failed recordUsage', () => {
  it('a recordUsage that throws does not latch: a second settle succeeds', async () => {
    const recordUsage = vi.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);
    const ctx = {
      recordUsage,
      refundDailyLimit: vi.fn().mockResolvedValue(undefined),
      refundBulkLimit: vi.fn().mockResolvedValue(undefined),
      refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
      resetCooldown: vi.fn().mockResolvedValue(undefined),
    } as unknown as AiContext;

    const global = { id: 'res_1', refunded: false } as unknown as GlobalReservation;
    const res = createCallReservation(ctx, 'uid_1', 'user', '2026-09-30', global);

    await expect(res.settle('done', { tokensIn: 10, tokensOut: 20 })).rejects.toThrow('db down');

    await expect(res.settle('done', { tokensIn: 10, tokensOut: 20 })).resolves.toBeUndefined();
    expect(recordUsage).toHaveBeenCalledTimes(2);
    // Резерв не потерян: done-путь написал usage, глобальный возврат не нужен.
    expect(ctx.refundGlobalRequest).not.toHaveBeenCalled();
  });

  it('a failed settle retry still refunds the daily limit and the reservation', async () => {
    const refundDailyLimit = vi.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined);
    const global = { id: 'res_2', refunded: false } as unknown as GlobalReservation;
    const ctx = {
      recordUsage: vi.fn().mockResolvedValue(undefined),
      refundDailyLimit,
      refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
      resetCooldown: vi.fn().mockResolvedValue(undefined),
    } as unknown as AiContext;

    const res = createCallReservation(ctx, 'uid_1', 'user', '2026-09-30', global, undefined, 'chat');
    await expect(res.settle('failed')).rejects.toThrow('db down');
    expect(ctx.refundGlobalRequest).not.toHaveBeenCalled();

    await expect(res.settle('failed')).resolves.toBeUndefined();
    // Первый вызов упал (не доехал до БД), второй — успешный повтор.
    expect(refundDailyLimit).toHaveBeenCalledTimes(2);
    expect(ctx.refundGlobalRequest).toHaveBeenCalledWith(global);
  });
});

// R4-082: без DATABASE_URL /ready обязан отвечать 503, а не изображать готовность.
// R4-051: 413 должен доходить до клиента по настоящему http-соединению.
// R5-005: настоящий сокет и холодный import('../server') — время стенное по
// природе, под нагрузкой оно превышало дефолтные 5 с. Поломка (не 503/413,
// оборванный сокет) краснеет assertion'ом или fetch failed сразу.
describe('/ready and csp-report on a real http.Server', { timeout: 30_000 }, () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl;
    else delete process.env.DATABASE_URL;
  });

  async function withServer(run: (port: number) => Promise<void>): Promise<void> {
    const { default: handler } = await import('../server');
    const real = await import('node:http');
    const server = real.createServer((req, res) => handler.emit('request', req, res));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      await run(port);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  }

  it('/ready answers 503 when the database is not configured', async () => {
    await withServer(async port => {
      const res = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(res.status).toBe(503);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('not_ready');
    });
  });

  it('POST /api/csp-report over the cap answers 413 with Connection: close', async () => {
    await withServer(async port => {
      const bigBody = 'x'.repeat(33 * 1024);
      const res = await fetch(`http://127.0.0.1:${port}/api/csp-report`, {
        method: 'POST',
        body: bigBody,
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status).toBe(413);
      expect(res.headers.get('connection')).toBe('close');
    });
  });
});
