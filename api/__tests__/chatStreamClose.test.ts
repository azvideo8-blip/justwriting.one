// TEST-1 §3.8: client disconnect before the first upstream byte refunds the
// slot; after bytes flowed, the work stays charged.
// The context is mocked (chat.ts flow is the subject); the assertion pins the
// refund CALL with the charged day threaded through.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let randomSpy: { mockRestore: () => void } | undefined;
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
    getAiConsent: vi.fn().mockResolvedValue({ granted: true }),
    getIndexingConsent: vi.fn().mockResolvedValue({ granted: true }),
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
    try {
      if (streamController && streamController.desiredSize !== null) {
        streamController.close();
        streamController = null;
      }
    } catch { /* поток уже закрыт — это нормальный исход отмены */ }
  });
  return new Response(sseBody, { status: 200 });
}));

import { handleChat, STREAM_BROKEN_NOTE } from '../chat';

afterEach(() => {
  randomSpy?.mockRestore();
  randomSpy = undefined;
});
import { buildChatSystemPrompt, assembleChatPromptParams } from '../../src/shared/ai/buildChatPrompt.js';
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
  write(chunk: string | Uint8Array) {
    this.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    firstByteAt ??= Date.now();
    return true;
  }
  // Настоящий ServerResponse после end() всегда эмитит 'close'. Без этого
  // заглушка не воспроизводит самую опасную ловушку AG-BILL-2: если ранний
  // settle('done') убрать, close после успешного ответа вернёт слот, и все
  // разговоры станут бесплатными. Проверено — без этой строки мутация
  // «убрать ранний settle('done')» не ловится ни одним тестом.
  end(chunk?: string) { if (chunk) this.body += chunk; this.ended = true; this.emit('close'); }
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
    cancel() {
      streamController = null;
    },
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
  vi.mocked(fetch).mockClear();
  firstByteAt = null;
  streamController = null;
});

describe('3.8 stream disconnect', () => {
  // DA-18: поставщик оборвал ответ посреди потока — человек должен это увидеть,
  // а не принять обрезанный текст за законченный.
  it('mid-stream upstream error appends a visible note to the answer', async () => {
    const content = JSON.stringify({ choices: [{ index: 0, delta: { content: 'Начало ответа' } }] });
    const err = JSON.stringify({ error: { message: 'upstream died' } });
    sseBody = sse([`data: ${content}\n\n`, `data: ${err}\n\n`]);
    const req = new FakeReq(validBody);
    const res = new FakeRes();
    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    expect(res.body).toContain('Начало ответа');
    expect(res.body.endsWith(STREAM_BROKEN_NOTE)).toBe(true);
  });

  // Потоковый режим рассуждений включает рассуждение у провайдера — промпт не
  // должен одновременно велеть «отвечай сразу, без хода мысли».
  it('reasoning-запрос не просит модель не думать и держит правило о языке', async () => {
    sseBody = holdOpen();
    const req = new FakeReq(validBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(res.headersSent).toBe(true), { timeout: 2000 });
    res.emit('close');
    await done;
    const body = String((vi.mocked(fetch).mock.calls[0]![1] as { body?: unknown }).body);
    expect(body).toContain('"effort"');
    expect(body).not.toContain('без хода мысли');
    expect(body).toContain('ТОЛЬКО на русском языке');
  });

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
    expect(refundDaily).toHaveBeenCalledWith('u_stream', '2026-08-20', 'reasoning');
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

    // AG-BILL-1: человек не получил разговор → слот возвращён.
    expect(refundDaily).toHaveBeenCalledTimes(1);
    expect(refundDaily).toHaveBeenCalledWith('u_stream', '2026-08-20', 'reasoning');
    expect(res.body).toBe('');
    // AG-BILL-2: сигнал close пришёл ДО первого куска поставщика — в этот
    // момент upstreamProduced ещё ложь, и резерв возвращается как холостой.
    // Токены, приехавшие позже в никуда, видны только в recordUsage.
    // MD-1: чат идёт на `AI_CHAT_MODEL`, поэтому в usage пишется v4.1-flash.
    expect(refundGlobal).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(
      'u_stream', 10, 3, { model: 'deepseek/deepseek-v4.1-flash', fn: 'chat-stream' }, { date: '2026-08-20', shardId: '0', allowance: 8192 },
    );
  });

  it('AUD-BILL-H2: полный провал апстрима не пишет строку usage', async () => {
    // Стрим падает до первого байта: слот возвращён settle('failed'), глобальный
    // резерв — тоже (upstreamProduced === false). recordUsage с нулевыми токенами
    // и requests+1 в такой ситуации только надувает статистику запросов.
    sseBody = holdOpen();

    const req = new FakeReq(validBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    await vi.waitFor(() => expect(res.headersSent).toBe(true), { timeout: 2000 });
    // Апстрим умирает сам, клиент никуда не уходит.
    streamController?.error(new Error('upstream died'));
    // Держим соединение живым, чтобы close-ветка не вмешалась.
    res.destroyed = false;

    await done;

    expect(refundDaily).toHaveBeenCalledTimes(1);
    expect(refundDaily).toHaveBeenCalledWith('u_stream', '2026-08-20', 'reasoning');
    expect(refundGlobal).toHaveBeenCalledTimes(1);
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('T-1: stream fails with producedChars === 0 refunds daily limit and global reservation', async () => {
    sseBody = holdOpen();

    const req = new FakeReq(validBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    await vi.waitFor(() => expect(res.headersSent).toBe(true), { timeout: 2000 });
    streamController?.error(new Error('upstream connection reset before any tokens'));
    res.destroyed = false;

    await done;

    expect(refundDaily).toHaveBeenCalledTimes(1);
    expect(refundDaily).toHaveBeenCalledWith('u_stream', '2026-08-20', 'reasoning');
    expect(refundBulk).not.toHaveBeenCalled();
    expect(refundGlobal).toHaveBeenCalledTimes(1);
    expect(recordUsage).not.toHaveBeenCalled();
  });

  // Порог объёма, а не факта: дыра DEEP-8 — это дочитать ответ и оборваться,
  // а не нажать «Стоп» на первом слоге. Фикстура выдаёт заведомо больше порога.
  it('DEEP-8: ответ дочитан, потом обрыв → слот НЕ возвращён, глобальный резерв тоже', async () => {
    // DEEP-8: Поставщик успел выдать и обработать кусок до разрыва — токены потрачены
    // по-настоящему, суточный слот и глобальный резерв списываются.
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
    // Сначала токен обработан (reasoning-ветка копит в contentAccum, в сокет
    // не пишет)...
    streamController?.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"аааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааааа"}}]}\n\n'));
    streamController?.enqueue(enc.encode('data: {"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n'));
    await vi.waitFor(() => expect(res.body).toBeDefined(), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 50));
    // ...потом клиент уходит посреди разговора.
    res.destroyed = true;
    res.emit('close');
    streamController?.close();

    await done;

    // DEEP-8: Токены обработаны -> ни слот, ни глобальный резерв не возвращаются
    expect(refundDaily).not.toHaveBeenCalled();
    expect(refundGlobal).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalled();
  });

  it('«Стоп» в начале ответа возвращает дневной слот, хотя поставщик уже что-то выдал', async () => {
    // Вторая половина правила DEEP-8, и та, которую первая реализация потеряла:
    // порог «хоть один токен» не срабатывал никогда, потому что до сервера
    // обрыв доходит позже, чем поставщик успевает выдать первый кусок. Проверка
    // после выкатки поймала это на живом сервере: слот списывался всегда.
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
    // Поставщик выдал пару слогов — меньше порога.
    streamController?.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Ти"}}]}\n\n'));
    await new Promise(r => setTimeout(r, 10));
    res.emit('close');
    streamController?.close();
    await done;

    expect(refundDaily, 'человек не получил ответа — слот обязан вернуться').toHaveBeenCalledTimes(1);
    expect(refundGlobal, 'а выданные токены оплачены: резерв не возвращается').not.toHaveBeenCalled();
  });

  it('порог считает текст, а не обёртку SSE: много мелких кадров — слот всё равно возвращается', async () => {
    // Ошибка, которую поймала только выкатка: в ветке рассуждений объём считался
    // по длине сырого кадра. `data: {"choices":[{"delta":{"content":"Ти"}}]}` —
    // это полсотни символов служебного текста на два содержательных, поэтому
    // порог проскакивал на первых же кадрах и слот не возвращался никогда.
    // Здесь обёртка заведомо больше порога, а содержимого — десяток символов.
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

    const frame = 'data: {"choices":[{"delta":{"content":"Ти"}}]}\n\n';
    expect(frame.length * 6, 'обёртка шести кадров обязана перекрыть порог').toBeGreaterThan(200);
    for (let i = 0; i < 6; i++) streamController?.enqueue(enc.encode(frame));
    await new Promise(r => setTimeout(r, 10));
    res.emit('close');
    streamController?.close();
    await done;

    expect(refundDaily, 'двенадцать символов текста — это не полученный ответ').toHaveBeenCalledTimes(1);
  });

  // AG-BILL-1 мутация: без !upstreamProduced тест выше обязан краснеть —
  // удаление условия !upstreamProduced делает тест красным, так как refundGlobal начнёт
  // вызываться после того, как поставщик уже потратил токены.

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

  const plainChatBody = {
    personaId: 'cbt',
    messages: [{ role: 'user' as const, content: 'Немного текста про день, достаточно длинного для валидации.' }],
  };

  it('AG-BILL-3: ordinary chat refunds slot and global reservation when client leaves before first chunk', async () => {
    sseBody = holdOpen();

    const req = new FakeReq(plainChatBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 2000 });
    res.emit('close');

    await done;

    expect(refundDaily).toHaveBeenCalledTimes(1);
    expect(refundDaily).toHaveBeenCalledWith('u_stream', '2026-08-20');
    expect(refundBulk).not.toHaveBeenCalled();
    expect(refundGlobal).toHaveBeenCalledTimes(1);
  });

  it('DEEP-8 / FU-1: обычный чат не возвращает слот, но сверяет резерв токенов при уходе клиента', async () => {
    // DLG-Q2: подборка примеров вопросов в промпте случайна от хода к ходу, а
    // тест пересобирает промпт сам, чтобы посчитать длину. Общую случайность
    // фиксируем — иначе эталон и запрос разъезжаются на один вопрос.
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const enc = new TextEncoder();
    const fetchMock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- типы vi.fn() здесь затёрты кастом
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) { streamController = controller; },
        cancel() { streamController = null; },
      }),
      { status: 200 },
    )));

    const req = new FakeReq(plainChatBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    await vi.waitFor(() => expect(streamController).not.toBeNull(), { timeout: 2000 });
    const chunk = JSON.stringify({ choices: [{ index: 0, delta: { content: 'а'.repeat(400) } }] });
    streamController?.enqueue(enc.encode(`data: ${chunk}\n\n`));
    await vi.waitFor(() => expect(res.body.length).toBeGreaterThan(0), { timeout: 2000 });
    res.destroyed = true;
    res.emit('close');

    await done;

    expect(refundDaily).not.toHaveBeenCalled();
    expect(refundGlobal).not.toHaveBeenCalled();
    // FU-1 & FU-4: Reconcile unconsumed reservation on abort mid-stream.
    // X-3: ценой хода считается собранный сервером промпт, а не 60 символов
    // запроса: прежние «20 токена» были ровно той недооценкой входа.
    const system = buildChatSystemPrompt(assembleChatPromptParams(plainChatBody as never));
    const expectedInput = Math.ceil((system.length + plainChatBody.messages[0]!.content.length) / 3);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(
      'u_stream',
      expectedInput,
      Math.ceil(400 / 3),
      expect.objectContaining({ fn: 'chat-stream-abort' }),
      expect.objectContaining({ allowance: 8192 }),
    );
  });

  it('FU-1: one reservation is reconciled at most once even if settle called multiple times', async () => {
    const enc = new TextEncoder();
    const fetchMock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- типы vi.fn() здесь затёрты кастом
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) { streamController = controller; },
        cancel() { streamController = null; },
      }),
      { status: 200 },
    )));

    const req = new FakeReq(plainChatBody);
    const res = new FakeRes();
    const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    await vi.waitFor(() => expect(streamController).not.toBeNull(), { timeout: 2000 });
    const chunk = JSON.stringify({ choices: [{ index: 0, delta: { content: 'тест' } }] });
    streamController?.enqueue(enc.encode(`data: ${chunk}\n\n`));
    await vi.waitFor(() => expect(res.body.length).toBeGreaterThan(0), { timeout: 2000 });
    // Emit close twice
    res.emit('close');
    res.emit('close');

    await done;

    expect(recordUsage).toHaveBeenCalledTimes(1);
  });

  it('AG-BILL-3: ordinary chat normal finish does NOT refund', async () => {
    const chunk = JSON.stringify({ choices: [{ index: 0, delta: { content: 'Привет' } }] });
    const usageChunk = JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } });
    sseBody = sse([
      `data: ${chunk}\n\n`,
      `data: ${usageChunk}\n\n`,
      'data: [DONE]\n\n',
    ]);

    const req = new FakeReq(plainChatBody);
    const res = new FakeRes();
    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    await vi.waitFor(() => expect(res.ended).toBe(true), { timeout: 2000 });

    expect(res.body).toContain('Привет');
    expect(refundDaily).not.toHaveBeenCalled();
    expect(refundBulk).not.toHaveBeenCalled();
    expect(refundGlobal).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalled();
  });

  it('AG-BILL-3: grep proof - both branches share createSettlement and delegate via createCallReservation', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const chatSrc = fs.readFileSync(path.resolve(__dirname, '../chat.ts'), 'utf-8');

    // createSettlement delegates to unified createCallReservation
    const createSettlementBlock = chatSrc.match(/function createSettlement[\s\S]*?^}/m)?.[0] ?? '';
    expect(createSettlementBlock).toContain('createCallReservation(');
    expect(createSettlementBlock).not.toContain('postgresAiContext.refundDailyLimit');

    // No refundDailyLimit or refundBulkLimit inside streamOpenRouterReasoning
    const reasoningBlock = chatSrc.match(/async function streamOpenRouterReasoning[\s\S]*?^}/m)?.[0] ?? '';
    expect(reasoningBlock).not.toContain('postgresAiContext.refundDailyLimit');
    expect(reasoningBlock).not.toContain('postgresAiContext.refundBulkLimit');

    // res.on('close') present in both streaming paths
    const closeListenerCount = (chatSrc.match(/res\.on\('close',\s*\(\)/g) || []).length;
    expect(closeListenerCount).toBe(2);
  });

  it('DA-1: settle on close catching DB failure does not produce unhandledRejection', async () => {
    refundDaily.mockRejectedValueOnce(new Error('DB disconnect on refund'));
    const unhandledRejections: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandledRejections.push(err);
    };
    process.on('unhandledRejection', onUnhandled);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      sseBody = holdOpen();
      const req = new FakeReq(validBody);
      const res = new FakeRes();
      const done = handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);
      await vi.waitFor(() => expect(res.headersSent).toBe(true), { timeout: 2000 });
      res.emit('close');
      await done;
      // Allow any microtasks to settle
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandledRejections).toHaveLength(0);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[chat] settle on close', 'name=Error');
    } finally {
      process.off('unhandledRejection', onUnhandled);
      consoleErrorSpy.mockRestore();
    }
  });
});

