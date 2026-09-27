// SA-2 (`ai-store-sync-durability/03`): чтение лимитов лежит в
// `try { } catch { /* non-critical */ }`. Когда Postgres не отвечает, заголовков
// `X-AI-Quota-*` нет вовсе, а клиент на отсутствии заголовка выходит молча
// (`useAiLimitStore.ts` syncFromHeaders) — и человеку показывается прошлое
// подтверждённое число как нынешнее. Отказ должен быть назван, а не промолчан.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';

const ctx = vi.hoisted(() => ({
  getDailyLimitCount: vi.fn(),
  isAdmin: vi.fn(),
  getAiConsent: vi.fn(),
  getIndexingConsent: vi.fn(),
  checkAndIncrementLimit: vi.fn(),
  checkAndIncrementBulkLimit: vi.fn(),
  refundDailyLimit: vi.fn(),
  refundBulkLimit: vi.fn(),
  refundGlobalRequest: vi.fn(),
  recordUsage: vi.fn(),
  tryReserveGlobalRequest: vi.fn(),
}));

vi.mock('../postgresAiContext', () => ({ postgresAiContext: ctx }));
vi.mock('../auth', () => ({
  requireSession: vi.fn(async () => ({ uid: 'u1', claims: {} })),
  passwordRecentlyVerified: vi.fn(() => true),
}));
vi.mock('../handlers', () => ({
  handleAiEndpoint: vi.fn(async () => ({ status: 200, body: { ok: true } })),
}));

const providerFetch = vi.fn(async () => new Response('data: [DONE]\n\n', { status: 200 }));
vi.stubGlobal('fetch', providerFetch);
process.env.OPENROUTER_API_KEY = 'test-key';

import { handle } from '../dispatcher';
import { handleChat } from '../chat';

class FakeRes extends EventEmitter {
  headersSent = false;
  statusCode = 0;
  body = '';
  destroyed = false;
  ended = false;
  private set = new Map<string, string>();
  setHeader(name: string, value: string) { this.set.set(name.toLowerCase(), String(value)); return this; }
  getHeader(name: string) { return this.set.get(name.toLowerCase()); }
  writeHead(code: number, headers?: Record<string, string>) {
    this.statusCode = code;
    this.headersSent = true;
    for (const [k, v] of Object.entries(headers ?? {})) this.set.set(k.toLowerCase(), String(v));
    return this;
  }
  end(chunk?: string) { if (chunk) this.body += chunk; this.ended = true; return this; }
  /** Заголовки ответа, собранные из обоих путей: writeHead и setHeader. */
  header(name: string): string | undefined { return this.set.get(name.toLowerCase()); }
}

function postBody() {
  return { personaId: 'cbt', messages: [{ role: 'user', content: 'привет' }] };
}

class FakeReq extends EventEmitter {
  method = 'POST';
  url: string;
  destroyed = false;
  headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.9' };
  constructor(body: unknown, url = '/api/editWithAI') {
    super();
    this.url = url;
    setTimeout(() => {
      this.emit('data', Buffer.from(JSON.stringify(body)));
      this.emit('end');
    }, 0);
  }
  destroy() { this.destroyed = true; }
}

beforeEach(() => {
  providerFetch.mockClear();
  for (const fn of Object.values(ctx)) fn.mockReset();
  ctx.getAiConsent.mockResolvedValue({ granted: true });
  ctx.getIndexingConsent.mockResolvedValue({ granted: true });
  ctx.checkAndIncrementLimit.mockResolvedValue({ ok: true, day: '2026-09-27' });
  ctx.checkAndIncrementBulkLimit.mockResolvedValue({ ok: true, day: '2026-09-27' });
  ctx.refundDailyLimit.mockResolvedValue(undefined);
  ctx.refundBulkLimit.mockResolvedValue(undefined);
  ctx.refundGlobalRequest.mockResolvedValue(undefined);
  ctx.recordUsage.mockResolvedValue(undefined);
  ctx.tryReserveGlobalRequest.mockResolvedValue({ date: '2026-09-27', shardId: '0', allowance: 256 });
  ctx.isAdmin.mockResolvedValue(false);
});

describe('SA-2: X-AI-Quota-Status', () => {
  it('диспетчер: чтение лимита упало → ответ несёт unavailable', async () => {
    ctx.getDailyLimitCount.mockRejectedValue(new Error('connection terminated unexpectedly'));
    const res = new FakeRes();
    await handle(new FakeReq({}) as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.statusCode).toBe(200);
    expect(res.header('X-AI-Quota-Status')).toBe('unavailable');
    // Числа при этом нет: врать про «осталось N» нельзя.
    expect(res.header('X-AI-Quota-Used')).toBeUndefined();
    expect(res.body).not.toContain('connection terminated');
  });

  it('диспетчер: чтение удалось → числам верим, unavailable нет', async () => {
    ctx.getDailyLimitCount.mockResolvedValue({ used: 3, reasoningUsed: 1, date: '2026-09-27' });
    const res = new FakeRes();
    await handle(new FakeReq({}) as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.header('X-AI-Quota-Used')).toBe('3');
    expect(res.header('X-AI-Quota-Status')).not.toBe('unavailable');
  });

  it('стрима чата: чтение лимита упало → заголовок уходит до начала тела', async () => {
    ctx.getDailyLimitCount.mockRejectedValue(new Error('connection terminated unexpectedly'));
    const req = new FakeReq(postBody(), '/api/chat');
    const res = new FakeRes();

    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.header('X-AI-Quota-Status')).toBe('unavailable');
  });

  it('стрима чата: чтение удалось → заголовки чисел на месте', async () => {
    ctx.getDailyLimitCount.mockResolvedValue({ used: 2, reasoningUsed: 0, date: '2026-09-27' });
    const req = new FakeReq(postBody(), '/api/chat');
    const res = new FakeRes();

    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.header('X-AI-Quota-Used')).toBe('2');
    expect(res.header('X-AI-Quota-Status')).not.toBe('unavailable');
  });
});
