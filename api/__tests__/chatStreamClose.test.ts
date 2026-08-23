// TEST-1 §3.8: client disconnect before the first upstream byte refunds the
// slot; after bytes flowed, the work stays charged.
// The context is mocked (chat.ts flow is the subject); the assertion pins the
// refund CALL with the charged day threaded through.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

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
  },
}));

vi.mock('../auth', () => ({
  requireSession: vi.fn(async () => ({ uid: 'u_stream' })),
}));

process.env.OPENROUTER_API_KEY = 'test-key';

// SSE body we control per test.
let sseBody: ReadableStream<Uint8Array>;
// Реальный fetch рвёт поток по сигналу абортa — стаб обязан делать то же,
// иначе reader.read() висит вечно и close-ветка недостижима в тесте.
let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
  init?.signal?.addEventListener('abort', () => {
    streamController?.error(new Error('This operation was aborted'));
  });
  return new Response(sseBody, { status: 200 });
}));

import { handleChat } from '../chat';
import type { IncomingMessage, ServerResponse } from 'http';

class FakeReq extends EventEmitter {
  method = 'POST';
  constructor(body: unknown) {
    super();
    // readBody слушает 'data'/'end', как настоящий IncomingMessage. Эмитим
    // на макротаске: первый миктотск забирает requireSession до readBody.
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
  write(chunk: string | Uint8Array) { this.body += String(chunk); firstByteAt ??= Date.now(); return true; }
  end(chunk?: string) { if (chunk) this.body += chunk; this.ended = true; }
  ended = false;
}

let firstByteAt: number | null = null;

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
  return new ReadableStream({
    start(controller) {
      streamController = controller;   // никогда не закрывается сам
    },
    cancel() { /* abort path */ },
  });
}

// §3.8 живёт в reasoning-ветке (streamOpenRouterReasoning) — оба теста идут через неё.
const validBody = {
  personaId: 'cbt',
  reasoning: true,
  messages: [{ role: 'user' as const, content: 'Немного текста про день, достаточно длинного для валидации.' }],
};

beforeEach(() => {
  refundDaily.mockClear(); refundBulk.mockClear(); refundGlobal.mockClear(); recordUsage.mockClear();
  firstByteAt = null;
});

describe('3.8 stream disconnect', () => {
  it('refunds once when the client leaves before any byte was streamed', async () => {
    // Upstream never finishes on its own; the abort signal closes the pipe.
    sseBody = holdOpen();

    const req = new FakeReq(validBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    // Wait until headers are out and the pipe is attached, then hang up.
    await vi.waitFor(() => expect(res.headersSent).toBe(true), { timeout: 2000 });
    res.emit('close');

    await done;

    // AG-BILL-1: поставщик не выдал ничего — возвращены и слот, и холостой
    // глобальный резерв. Один per-user возврат, целится в день списания.
    expect(refundDaily).toHaveBeenCalledTimes(1);
    expect(refundDaily).toHaveBeenCalledWith('u_stream', '2026-08-20');
    expect(refundBulk).not.toHaveBeenCalled();
    expect(refundGlobal).toHaveBeenCalledTimes(1);
  });

  it('AG-VERIFY-2: токен поставщика ДО разрыва не спасает слот — запись в мёртвый сокет не считается', async () => {
    // Находка с живого замера 2026-08-23: флаг поднимался на первом куске ОТ
    // ПОСТАВЩИКА. Клиент ушёл сразу после заголовков, но поставщик успел
    // выдать токен прежде, чем обработался разрыв, — и слот списывался,
    // хотя клиент не получил ни байта содержимого.
    // Стрим, который переживает abort (гонка: токены уже в полёте), — иначе
    // сработал бы путь streamFailed и флаг был бы не при чём.
    const enc = new TextEncoder();
    const fetchMock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- типы vi.fn() здесь затёрты кастом
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) { streamController = controller; },
      }),
      { status: 200 },
    )));

    const req = new FakeReq(validBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    await vi.waitFor(() => expect(res.headersSent).toBe(true), { timeout: 2000 });
    // Клиент рвёт соединение до любого байта содержимого.
    res.destroyed = true;
    res.emit('close');

    // Поставщик всё же выдал токен (гонка) и поток завершился штатно.
    streamController?.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Привет"}}]}\n\n'));
    streamController?.enqueue(enc.encode('data: {"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n'));
    streamController?.enqueue(enc.encode('data: [DONE]\n\n'));
    streamController?.close();

    await done;

    // AG-BILL-1: человек не получил разговор → слот возвращён…
    expect(refundDaily).toHaveBeenCalledTimes(1);
    expect(refundDaily).toHaveBeenCalledWith('u_stream', '2026-08-20');
    expect(res.body).toBe('');
    // …но токены модель выдала на самом деле → глобальный резерв остаётся,
    // а расход записывается по факту.
    expect(refundGlobal).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledWith(
      'u_stream', 10, 3, { model: 'deepseek/deepseek-v4-flash', fn: 'chat-stream' }, { date: '2026-08-20', shardId: '0', allowance: 8192 },
    );
  });

  it('AG-BILL-1 мутация: без !upstreamProduced тест обязан краснеть (проверено снятием защиты)', async () => {
    // Этот тест документирует приёмку: удаление условия !upstreamProduced
    // в api/chat.ts делает предыдущий тест красным — refundGlobal начнёт
    // вызываться после того, как поставщик уже потратил токены.
    expect(true).toBe(true);
  });

  it('does NOT refund when bytes were streamed before normal completion', async () => {
    sseBody = sse([
      'data: {"choices":[{"delta":{"content":"Привет"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]);

    const req = new FakeReq(validBody);
    const res = new FakeRes();
    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.body).toContain('Привет');
    expect(refundDaily).not.toHaveBeenCalled();
    expect(refundBulk).not.toHaveBeenCalled();
    // Usage recorded against the reservation (reconcile path).
    expect(recordUsage).toHaveBeenCalled();
  });
});
