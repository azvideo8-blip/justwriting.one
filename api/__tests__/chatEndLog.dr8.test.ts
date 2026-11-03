// DR-8 (часть 2): строка `[chat-end]` пишется ровно один раз на ход и именно с
// той причиной, которая случилась. Ветвь рассуждений гоняется на управляемом SSE,
// обычная — на макете streamText. Текста пользователя в строке нет (это же
// проверяет serverLogsPrivacy.audit42).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const { refundDaily, refundGlobal, recordUsage } = vi.hoisted(() => ({
  refundDaily: vi.fn().mockResolvedValue(undefined),
  refundGlobal: vi.fn().mockResolvedValue(undefined),
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-10' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-10' }),
    refundDailyLimit: (...a: unknown[]) => refundDaily(...(a as [])),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: (...a: unknown[]) => refundGlobal(...(a as [])),
    recordUsage: (...a: unknown[]) => recordUsage(...(a as [])),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-10-10', shardId: '0', allowance: 8192 }),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn(),
    isAdmin: vi.fn(),
    checkDailyLimit: vi.fn(),
    getAiConsent: vi.fn().mockResolvedValue({ granted: true }),
    getIndexingConsent: vi.fn().mockResolvedValue({ granted: true }),
  },
}));

const streamTextMock = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: streamTextMock.mockImplementation(() => ({ pipeTextStreamToResponse: vi.fn() })) };
});

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_dr8' })) }));

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';
import { ANSWER_CUT_NOTE } from '../../src/shared/ai/aiPolicy';
import type { IncomingMessage, ServerResponse } from 'node:http';

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
  writableEnded = false;
  writeHead(code: number) { this.statusCode = code; this.headersSent = true; return this; }
  write(chunk: string | Uint8Array) { this.body += String(chunk); return true; }
  end(chunk?: string) { if (chunk) this.body += String(chunk); this.ended = true; this.writableEnded = true; this.emit('close'); }
}

let sseBody: ReadableStream<Uint8Array> = new ReadableStream({ start(c) { c.close(); } });
let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
  init?.signal?.addEventListener('abort', () => {
    try { streamController?.close(); streamController = null; } catch { /* уже закрыт */ }
  });
  return new Response(sseBody, { status: 200 });
}));

function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function holdOpen(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { streamController = controller; }, cancel() { streamController = null; } });
}

const reasoningBody = {
  personaId: 'cbt',
  reasoning: true,
  messages: [{ role: 'user' as const, content: 'Немного текста про день, достаточно длинного для валидации.' }],
};
const plainBody = {
  personaId: 'cbt',
  messages: [{ role: 'user' as const, content: 'Немного текста про день, достаточно длинного для валидации.' }],
};

let infoCalls: unknown[][] = [];

function endLines(): string[] {
  return infoCalls
    .map(args => args.map(a => String(a)).join(' '))
    .filter(line => line.includes('[chat-end]'));
}

beforeEach(() => {
  vi.clearAllMocks();
  infoCalls = [];
  vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => { infoCalls.push(args); });
  refundDaily.mockClear();
  streamController = null;
  streamTextMock.mockImplementation(() => ({ pipeTextStreamToResponse: vi.fn() }));
});

describe('DR-8: [chat-end] на потоковых ходах', () => {
  it('ветвь рассуждений: поставщик дописал ответ → finish=stop один раз', async () => {
    sseBody = sse([
      'data: {"choices":[{"delta":{"content":"Привет"},"finish_reason":"stop"}]}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":1305}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const res = new FakeRes();
    await handleChat(new FakeReq(reasoningBody) as unknown as IncomingMessage, res as unknown as ServerResponse);
    const lines = endLines();
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!.split('[chat-end]')[1]!.trim()) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['finish', 'ms', 'out_tokens']);
    expect(parsed.finish).toBe('stop');
    expect(parsed.out_tokens).toBe(1305);
    expect(typeof parsed.ms).toBe('number');
  });

  it('ветвь рассуждений: поставщик оборвал на лимите → finish=length', async () => {
    sseBody = sse([
      'data: {"choices":[{"delta":{"content":"много текста"},"finish_reason":"length"}]}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":3000}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const res = new FakeRes();
    await handleChat(new FakeReq(reasoningBody) as unknown as IncomingMessage, res as unknown as ServerResponse);
    const lines = endLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"finish":"length"');
  });

  it('ветвь рассуждений: error-кадр → finish=provider_error', async () => {
    sseBody = sse([
      'data: {"choices":[{"delta":{"content":"начало"}}]}\n\n',
      'data: {"error":{"code":"server_error","message":"upstream died"}}\n\n',
    ]);
    const res = new FakeRes();
    await handleChat(new FakeReq(reasoningBody) as unknown as IncomingMessage, res as unknown as ServerResponse);
    const lines = endLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"finish":"provider_error"');
  });

  it('ветвь рассуждений: клиент ушёл посреди потока → finish=client_abort', async () => {
    sseBody = holdOpen();
    const res = new FakeRes();
    const done = handleChat(new FakeReq(reasoningBody) as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(res.headersSent).toBe(true), { timeout: 2000 });
    res.emit('close');
    await done;
    const lines = endLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"finish":"client_abort"');
  });

  it('обычный ход: onFinish дал usage → finish=stop, строка одна', async () => {
    streamTextMock.mockImplementation((opts: { onFinish?: (r: unknown) => Promise<void> }) => {
      void opts.onFinish?.({ totalUsage: { inputTokens: 12, outputTokens: 800 } });
      return {
        textStream: { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) },
        pipeTextStreamToResponse: vi.fn(),
      };
    });
    const res = new FakeRes();
    await handleChat(new FakeReq(plainBody) as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(endLines().length).toBe(1), { timeout: 2000 });
    expect(endLines()[0]).toContain('"finish":"stop"');
  });

  // DY7-8: «упёрся в предел» — одно правило на оба потока (`answerHitLimit`):
  // поставщик без finish_reason, но выдача на потолке — пометка в ответе и
  // finish=length в журнале. Мутация: вернуть обычному потоку только
  // finishReason SDK → пометки нет, а журнал говорит length.
  it('обычный ход: потолок без finish_reason → пометка и finish=length', async () => {
    const chunks = ['Часть ', 'ответа'];
    // Как SDK: onFinish (с usage) отрабатывает до конца textStream.
    streamTextMock.mockImplementation((opts: { onFinish?: (r: unknown) => Promise<void>; maxOutputTokens: number }) => ({
      textStream: {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            if (chunks.length) return { done: false, value: chunks.shift()! };
            await opts.onFinish?.({ totalUsage: { inputTokens: 12, outputTokens: opts.maxOutputTokens } });
            return { done: true, value: undefined };
          },
        }),
      },
      pipeTextStreamToResponse: vi.fn(),
    }));
    const res = new FakeRes();
    await handleChat(new FakeReq(plainBody) as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(endLines().length).toBe(1), { timeout: 2000 });
    expect(endLines()[0]).toContain('"finish":"length"');
    expect(res.body.endsWith(ANSWER_CUT_NOTE)).toBe(true);
  });

  it('обычный ход: onError поставщика → finish=provider_error', async () => {
    streamTextMock.mockImplementation((opts: { onError?: (e: unknown) => void }) => {
      opts.onError?.(new Error('upstream 502'));
      return { pipeTextStreamToResponse: vi.fn() };
    });
    const res = new FakeRes();
    await handleChat(new FakeReq(plainBody) as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(endLines().length).toBe(1), { timeout: 2000 });
    expect(endLines()[0]).toContain('"finish":"provider_error"');
  });

  it('обычный ход: клиент ушёл до первого куска → finish=client_abort', async () => {
    streamTextMock.mockImplementation(() => ({
      textStream: {
        [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
      },
      pipeTextStreamToResponse: vi.fn(),
    }));
    const res = new FakeRes();
    const done = handleChat(new FakeReq(plainBody) as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(streamTextMock).toHaveBeenCalled(), { timeout: 2000 });
    res.emit('close');
    void done;
    await vi.waitFor(() => expect(endLines().length).toBe(1), { timeout: 2000 });
    expect(endLines()[0]).toContain('"finish":"client_abort"');
  });
});
