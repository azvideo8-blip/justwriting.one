// R7Q-017: дедлайн 150 с в не-рассуждающем потоке. `waitForNextOrAbort` на abort
// резолвит {done:true} и не бросает, поэтому контроль доходил до
// `if (controller.signal.aborted || res.destroyed) { endChat(); return; }` — без
// settle и без ответа: слот дневной квоты оставался списанным, резерв
// `ai_global_daily` — занятым (429 раньше для всех), а браузер висел до
// proxy_read_timeout nginx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';

const { refundDaily, refundBulk, refundGlobal, recordUsage } = vi.hoisted(() => ({
  refundDaily: vi.fn().mockResolvedValue(undefined),
  refundBulk: vi.fn().mockResolvedValue(undefined),
  refundGlobal: vi.fn().mockResolvedValue(undefined),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-20' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-20' }),
    refundDailyLimit: (...a: unknown[]) => refundDaily(...(a as [])),
    refundBulkLimit: (...a: unknown[]) => refundBulk(...(a as [])),
    refundGlobalRequest: (...a: unknown[]) => refundGlobal(...(a as [])),
    recordUsage,
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-08-20', shardId: '0', allowance: 8192 }),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn(),
    isAdmin: vi.fn(),
    checkDailyLimit: vi.fn(),
    getAiConsent: vi.fn().mockResolvedValue({ granted: true }),
    getIndexingConsent: vi.fn().mockResolvedValue({ granted: true }),
  },
}));

vi.mock('../auth', () => ({
  requireSession: vi.fn(async () => ({ uid: 'u_hang' })),
}));

process.env.OPENROUTER_API_KEY = 'test-key';

let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
  init?.signal?.addEventListener('abort', () => {
    try {
      if (streamController && streamController.desiredSize !== null) {
        streamController.close();
        streamController = null;
      }
    } catch { /* поток уже закрыт */ }
  });
  // Тело, которое само не заканчивается: поставщик «висит».
  const body = new ReadableStream<Uint8Array>({
    start(c) { streamController = c; },
    cancel() { streamController = null; },
  });
  return new Response(body, { status: 200 });
}));

const { handleChat } = await import('../chat');

class FakeReq extends EventEmitter {
  method = 'POST';
  constructor(body: unknown) {
    super();
    setTimeout(() => {
      this.emit('data', Buffer.from(JSON.stringify(body)));
      this.emit('end');
    }, 0);
  }
}

class FakeRes extends EventEmitter {
  headersSent = false;
  statusCode = 0;
  body = '';
  ended = false;
  destroyed = false;
  /** Сколько возвратов квоты уже случилось к моменту, когда сервер что-то ответил. */
  refundsAtStatus = -1;
  writeHead(code: number) {
    this.statusCode = code;
    this.headersSent = true;
    this.refundsAtStatus = refundDaily.mock.calls.length;
    return this;
  }
  setHeader() { return this; }
  getHeader() { return undefined; }
  write(chunk: string | Uint8Array) {
    this.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }
  end(chunk?: string) { if (chunk) this.body += chunk; this.ended = true; this.emit('close'); }
}

const chatBody = {
  personaId: 'cbt',
  messages: [{ role: 'user' as const, content: 'Расскажи, что было в последних записях, пожалуйста.' }],
};

describe('R7Q-017: зависший поставщик на дедлайне отписывает квоту и отвечает 504', () => {
  beforeEach(() => {
    refundDaily.mockClear(); refundBulk.mockClear(); refundGlobal.mockClear(); recordUsage.mockClear();
    vi.mocked(fetch).mockClear();
    streamController = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('150 с без первого куска — возврат слота и резерва, тело 504 UPSTREAM_TIMEOUT', async () => {
    const req = new FakeReq(chatBody);
    const res = new FakeRes();

    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    // Дойти до ожидания потока и ничего не вернуть раньше времени.
    await vi.advanceTimersByTimeAsync(149_000);
    expect(refundDaily).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(0);

    await vi.advanceTimersByTimeAsync(2_000);
    await done;

    expect(res.statusCode).toBe(504);
    expect(res.body).toContain('UPSTREAM_TIMEOUT');
    expect(res.ended).toBe(true);
    // Расчёт возвращён ДО ответа. В исходной дыре `return` шёл без settle, а
    // `res.on('close')` — единственный, кто его делал, — не срабатывал: клиент
    // висел на незакрытом ответе, и слот оставался списанным до конца дня.
    expect(res.refundsAtStatus).toBe(1);
    expect(refundDaily).toHaveBeenCalledTimes(1);
    expect(refundDaily).toHaveBeenCalledWith('u_hang', '2026-08-20');
    expect(refundGlobal).toHaveBeenCalledTimes(1);
  });
});
