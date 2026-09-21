import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-20' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-20' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
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
  requireSession: vi.fn(async () => ({ uid: 'u_err1' })),
}));

let mockStreamTextFailImmediately = false;

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: vi.fn((opts: { onError?: (e: unknown) => Promise<void> }) => {
      // Real SDK: streamText returns synchronously!
      // Any error or chunk happens asynchronously across event loop ticks.
      if (mockStreamTextFailImmediately) {
        return {
          // eslint-disable-next-line require-yield -- deliberately throws before any yield, to model a stream that fails before producing a chunk
          textStream: (async function* () {
            await new Promise((r) => setTimeout(r, 10));
            const err = new Error('OpenRouter 500: Provider overloaded');
            if (opts.onError) {
              await opts.onError(err);
            }
            throw err;
          })(),
        };
      }
      return {
        textStream: (async function* () {
          await new Promise((r) => setTimeout(r, 10));
          yield 'Привет! ';
          await new Promise((r) => setTimeout(r, 10));
          yield 'Как дела?';
        })(),
      };
    }),
  };
});

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';

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
  writeHead(code: number) {
    this.statusCode = code;
    this.headersSent = true;
    return this;
  }
  write(chunk: string | Uint8Array) {
    this.body += String(chunk);
    return true;
  }
  end(chunk?: string) {
    if (chunk) this.body += chunk;
    this.emit('close');
  }
}

describe('ERR-1: upstream failure before first chunk returns non-200', () => {
  beforeEach(() => {
    mockStreamTextFailImmediately = false;
  });

  it('returns 502 UPSTREAM_ERROR when async error triggers before first chunk', async () => {
    mockStreamTextFailImmediately = true;

    const req = new FakeReq({
      personaId: 'cbt',
      messages: [{ role: 'user', content: 'Привет' }],
    });
    const res = new FakeRes();

    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('UPSTREAM_ERROR');
  });

  it('returns 200 and streams text when upstream responds normally', async () => {
    mockStreamTextFailImmediately = false;

    const req = new FakeReq({
      personaId: 'cbt',
      messages: [{ role: 'user', content: 'Привет' }],
    });
    const res = new FakeRes();

    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('Привет! Как дела?');
  });
});
