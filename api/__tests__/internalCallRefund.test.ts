import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const { refundDaily, refundBulk, refundGlobal } = vi.hoisted(() => ({
  refundDaily: vi.fn().mockResolvedValue(undefined),
  refundBulk: vi.fn().mockResolvedValue(undefined),
  refundGlobal: vi.fn().mockResolvedValue(undefined),
}));

let capturedOnError: ((e: unknown) => Promise<void>) | null = null;

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: vi.fn((opts: {
      onFinish?: (r: unknown) => Promise<void>;
      onError?: (e: unknown) => Promise<void>;
    }) => {
      capturedOnError = opts.onError ?? null;
      return { pipeTextStreamToResponse: vi.fn() };
    }),
  };
});

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-20' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-20' }),
    refundDailyLimit: (...a: unknown[]) => refundDaily(...(a as [])),
    refundBulkLimit: (...a: unknown[]) => refundBulk(...(a as [])),
    refundGlobalRequest: (...a: unknown[]) => refundGlobal(...(a as [])),
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
  requireSession: vi.fn(async () => ({ uid: 'u_internal' })),
}));

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';
import type { IncomingMessage, ServerResponse } from 'http';

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
  destroyed = false;
  writeHead(code: number) { this.statusCode = code; this.headersSent = true; return this; }
  write(chunk: string | Uint8Array) { this.body += String(chunk); return true; }
  end(chunk?: string) { if (chunk) this.body += chunk; this.ended = true; this.emit('close'); }
  ended = false;
}

beforeEach(() => {
  refundDaily.mockClear();
  refundBulk.mockClear();
  refundGlobal.mockClear();
  capturedOnError = null;
});

describe('B-2 (F-009) internal call refunds to internal_chat row', () => {
  it('refunds internal_chat row when an internal call stream fails before producing text', async () => {
    const internalBody = {
      personaId: 'editor',
      callType: 'auto_name',
      messages: [{ role: 'user' as const, content: 'Заголовок для заметки: тестовый текст' }],
    };

    const req = new FakeReq(internalBody);
    const res = new FakeRes();

    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(capturedOnError).not.toBeNull(), { timeout: 2000 });

    await capturedOnError!(new Error('upstream failed'));
    await done;

    // Must refund the 'internal_chat' row, NOT 'chat'
    expect(refundBulk).toHaveBeenCalledTimes(1);
    expect(refundBulk).toHaveBeenCalledWith('u_internal', '2026-08-20', 'internal_chat');
    expect(refundDaily).not.toHaveBeenCalled();
  });
});
