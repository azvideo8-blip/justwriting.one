// DLG-Q4: серверное применение подсказки языка. Проверяется на реальном
// handleChat — важно, что подсказка стоит в запросе провайдеру, а не в
// служебном вызове, и что в режиме рассуждений она не спорит с правилом языка.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const { streamTextMock, tryReserve } = vi.hoisted(() => ({ streamTextMock: vi.fn(), tryReserve: vi.fn() }));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: streamTextMock.mockImplementation(() => ({ pipeTextStreamToResponse: vi.fn() })),
  };
});

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-07' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-07' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: (...a: unknown[]) => tryReserve(...(a as [])),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn(),
    isAdmin: vi.fn(),
    checkDailyLimit: vi.fn(),
    getAiConsent: vi.fn().mockResolvedValue({ granted: true }),
    getIndexingConsent: vi.fn().mockResolvedValue({ granted: true }),
  },
}));

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_q4' })) }));

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
  ended = false;
  writeHead(code: number) { this.statusCode = code; this.headersSent = true; return this; }
  write(chunk: string | Uint8Array) { this.body += String(chunk); return true; }
  end(chunk?: string) { if (chunk) this.body += chunk; this.ended = true; this.emit('close'); }
}

type Sent = { system?: string; messages?: Array<{ role: string; content: string }> };

async function send(overrides: Record<string, unknown> = {}): Promise<Sent> {
  streamTextMock.mockClear();
  const req = new FakeReq({
    personaId: 'cbt',
    messages: [{ role: 'user', content: 'I want to run a half marathon next spring, how do I start?' }],
    ...overrides,
  });
  await handleChat(req as unknown as IncomingMessage, new FakeRes() as unknown as ServerResponse);
  return (streamTextMock.mock.calls[0]?.[0] ?? {}) as Sent;
}

const EN = 'I want to run a half marathon next spring, how do I start?';

describe('Q-4: подсказка языка на сервере', () => {
  beforeEach(() => {
    tryReserve.mockReset();
    tryReserve.mockResolvedValue({ date: '2026-10-07', shardId: '0', allowance: 8192 });
  });

  it('английская реплика: последнее сообщение провайдера кончается подсказкой', async () => {
    const sent = await send();
    const last = sent.messages?.[sent.messages.length - 1];
    expect(last?.content.endsWith('(Answer in English.)')).toBe(true);
  });

  it('русская реплика: без подсказки', async () => {
    const sent = await send({ messages: [{ role: 'user', content: 'хочу бегать по утрам, с чего начать?' }] });
    expect(JSON.stringify(sent.messages)).not.toContain('Answer in English');
  });

  it('служебный вызов (auto_name) подсказки не получает', async () => {
    const sent = await send({ callType: 'auto_name' });
    expect(JSON.stringify(sent.messages)).not.toContain('Answer in English');
  });

  it('рассуждения + английская реплика: английское правило вместо русского', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: unknown }) => new Response('data: [DONE]\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const req = new FakeReq({ personaId: 'cbt', reasoning: true, messages: [{ role: 'user', content: EN }] });
      await handleChat(req as unknown as IncomingMessage, new FakeRes() as unknown as ServerResponse);
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const wire = JSON.stringify(body.messages ?? []);
      expect(wire).toContain('reason and answer ONLY in English');
      expect(wire).not.toContain('ТОЛЬКО на русском');
      expect(wire).toContain('(Think in English and answer in English.)');
      // двойной подсказки языка быть не должно
      expect(wire).not.toContain('(Answer in English.)');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
