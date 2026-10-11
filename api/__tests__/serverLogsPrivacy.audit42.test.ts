// Аудит 0.9.34, область §4.2 (пункт 3): что пишет сервер в свой стандартный вывод.
//
// На обеих серверных ветках (`api/chat.ts` и `api/ai/chatWithAI.logic.ts`) прогоняем
// запрос с уникальными маркерами в тексте заметки, её заголовке, портрете, памяти и
// репликах диалога и слушаем `console.*`. Маркер не имеет права появиться в журнале:
// серверные логи читаются людьми и инструментами, которые не видят сейфа пользователя.
//
// Отдельно проверяется структурный лог формы хода (`[chat-shape]`) — он создан ровно
// для того, чтобы не печатать содержимое.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { chatWithAILogic } from '../ai/chatWithAI.logic';
import { generate } from '../ai/provider';
import type { AiContext } from '../../src/shared/ai/context.js';
import { logChatShape } from '../../src/shared/ai/chatShape.js';
import { summarizeDocumentLogic } from '../ai/summarizeDocument.logic';

vi.mock('../ai/provider', () => ({
  generate: vi.fn(),
  getActiveModel: vi.fn().mockResolvedValue('test-model'),
}));

// W-4: чтобы прогнать потоковую ветку (`api/chat.ts`) с управляемым сбоем
// поставщика.
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
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-08' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-08' }),
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

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_audit42' })) }));

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';
import type { IncomingMessage, ServerResponse } from 'node:http';

const M_NOTE = 'МАРКЕР-ТЕЛА-ЗАМЕТКИ';
const M_TITLE = 'МАРКЕР-ЗАГОЛОВКА';
const M_PORTRAIT = 'МАРКЕР-ПОРТРЕТА';
const M_MEMORY = 'МАРКЕР-ПАМЯТИ';
const M_MESSAGE = 'МАРКЕР-РЕПЛИКИ';
const ALL_MARKERS = [M_NOTE, M_TITLE, M_PORTRAIT, M_MEMORY, M_MESSAGE];

const ctx = () => ({
  checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-08' }),
  refundDailyLimit: vi.fn().mockResolvedValue(undefined),
  checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-08' }),
  refundBulkLimit: vi.fn().mockResolvedValue(undefined),
  tryReserveGlobalRequest: vi.fn().mockResolvedValue({ id: 'res_audit42' }),
  refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
  recordUsage: vi.fn().mockResolvedValue(undefined),
  recordDailySpendRub: vi.fn().mockResolvedValue(undefined),
} as unknown as AiContext);

const payload = (extra: Record<string, unknown> = {}) => ({
  personaId: 'coach',
  messages: [{ role: 'user', content: M_MESSAGE }],
  documentContent: `[#local_audit42 · 20261008]\n[Прикреплена заметка: "${M_TITLE}"]\n${M_NOTE}`,
  userPortrait: M_PORTRAIT,
  memoryContext: M_MEMORY,
  ...extra,
});

let logs: string[] = [];
function spyConsole() {
  logs = [];
  const collect = (...args: unknown[]) => { logs.push(args.map(a => String(a)).join(' ')); };
  vi.spyOn(console, 'error').mockImplementation(collect);
  vi.spyOn(console, 'warn').mockImplementation(collect);
  vi.spyOn(console, 'info').mockImplementation(collect);
  vi.spyOn(console, 'log').mockImplementation(collect);
}

function loggedMarkers(): string[] {
  const text = logs.join('\n');
  return ALL_MARKERS.filter(m => text.includes(m));
}

function loggedText(): string {
  return logs.join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  spyConsole();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('аудит §4.2: серверные журналы не содержат содержимого пользователя', () => {
  it('успешный ход: ни один маркер не попадает в вывод', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'ответ', tokensIn: 10, tokensOut: 10, model: 'test-model' } as never);
    await chatWithAILogic(ctx(), 'user_audit42', payload());
    expect(loggedMarkers()).toEqual([]);
  });

  it('отказ провайдера: текст ошибки не печатается целиком', async () => {
    // Провайдер возвращает ошибку, в которой оказывается кусок входа (эхо тела
    // запроса в сообщении 400 — обычное поведение HTTP-клиентов). Сервер печатает
    // ошибку как есть, и эхо уезжает в журнал.
    vi.mocked(generate).mockRejectedValue(new Error(
      `400 Bad Request: {"messages":[{"role":"user","content":"${M_MESSAGE}"}],"note":"${M_NOTE}"}`) as never);
    await expect(chatWithAILogic(ctx(), 'user_audit42', payload())).rejects.toThrow();
    expect(loggedMarkers()).toEqual([]);
  });

  it('непрошедшая валидация схемы: формат ошибок zod не раскрывает содержимое', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'ответ', tokensIn: 1, tokensOut: 1, model: 'test-model' } as never);
    // documentContent длиннее предела схемы — поле отбраковывается, и в лог идёт
    // формат ошибок. Важно, что там только имена полей и сообщения, а не значения.
    // Схема отбрасывает ход и бросает AiError после строки журнала.
    await expect(chatWithAILogic(ctx(), 'user_audit42', payload({ documentContent: `${M_NOTE} ${'заполнение '.repeat(9000)}` })))
      .rejects.toThrow();
    expect(loggedMarkers()).toEqual([]);
  });

  it('структурный лог формы хода печатает только размеры', () => {
    logChatShape({
      personaId: 'coach',
      responseLength: 'standard',
      reasoning: false,
      crisis: false,
      noteScope: { mode: 'note', title: M_TITLE, date: '20261008' },
      documentContent: payload().documentContent as string,
      memoryContext: M_MEMORY,
      userPortrait: M_PORTRAIT,
      messages: [{ role: 'user', content: M_MESSAGE }],
      system: '很长的 системный промпт, считается только длиной',
    } as never);
    expect(loggedMarkers()).toEqual([]);
  });
});

// W-4: каждое место печати сбоя провайдера прогоняется отдельно, с эхом
// пользовательского текста в ошибке. Проверка двусторонняя: метка места обязана
// появиться в журнале (иначе тест краснеет vacuous), а маркеры — нет.
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

let fetchImpl: (url: unknown, init?: { signal?: AbortSignal }) => Promise<Response> = async () => new Response('', { status: 200 });
vi.stubGlobal('fetch', (url: unknown, init?: { signal?: AbortSignal }) => fetchImpl(url, init));

function sseStream(lines: string[], failWith?: Error): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l));
      if (failWith) controller.error(failWith);
      else controller.close();
    },
  });
}

async function sendStream(overrides: Record<string, unknown> = {}): Promise<void> {
  const req = new FakeReq({
    personaId: 'coach',
    messages: [{ role: 'user', content: M_MESSAGE }],
    documentContent: payload().documentContent,
    userPortrait: M_PORTRAIT,
    memoryContext: M_MEMORY,
    ...overrides,
  });
  await handleChat(req as unknown as IncomingMessage, new FakeRes() as unknown as ServerResponse);
}

const echo = (marker: string): string => `400 Bad Request: echoed body {"content":"${marker}"}`;

describe('W-4: места печати сбоя провайдера', () => {
  beforeEach(() => {
    tryReserve.mockReset();
    tryReserve.mockResolvedValue({ date: '2026-10-08', shardId: '0', allowance: 3000 });
    streamTextMock.mockImplementation(() => ({ pipeTextStreamToResponse: vi.fn() }));
    fetchImpl = async () => new Response('', { status: 200 });
  });

  it('чат с рассуждением: fetch упал — печатается место, а не текст ошибки', async () => {
    fetchImpl = async () => { throw new Error(echo(M_NOTE)); };
    await sendStream({ reasoning: true });
    expect(loggedText()).toContain('[api/chat] upstream request failed:');
    expect(loggedMarkers()).toEqual([]);
  });

  it('чат с рассуждением: поставщик вернул 4xx с эхом тела — тело не читается', async () => {
    fetchImpl = async () => new Response(echo(M_MESSAGE), { status: 400 });
    await sendStream({ reasoning: true });
    expect(loggedText()).toContain('[api/chat] reasoning upstream returned error: status=400');
    expect(loggedMarkers()).toEqual([]);
  });

  it('чат с рассуждением: error-кадр в потоке — печатается код, а не сообщение', async () => {
    const frame = JSON.stringify({ error: { code: 'context_length_exceeded', message: echo(M_MEMORY) } });
    fetchImpl = async () => new Response(sseStream([`data: ${frame}\n\n`]), { status: 200 });
    await sendStream({ reasoning: true });
    expect(loggedText()).toContain('reasoning upstream returned chunk error: status=200 code=context_length_exceeded');
    expect(loggedMarkers()).toEqual([]);
  });

  it('чат с рассуждением: поток оборвался при чтении — только имя класса', async () => {
    const err = new TypeError(echo(M_TITLE));
    const body = sseStream(['data: {"choices":[{"delta":{"content":"начало"}}]}\n\n'], err);
    fetchImpl = async () => new Response(body, { status: 200 });
    await sendStream({ reasoning: true });
    expect(loggedText()).toContain('[api/chat] stream read failed: name=TypeError');
    expect(loggedMarkers()).toEqual([]);
  });

  it('обычный ход: onError поставщика получает только форму ошибки', async () => {
    streamTextMock.mockImplementation((opts: { onError?: (e: unknown) => void }) => {
      opts.onError?.(new Error(echo(M_NOTE)));
      return { pipeTextStreamToResponse: vi.fn() };
    });
    await sendStream();
    expect(loggedText()).toContain('[api/chat] streamText failed: name=Error');
    expect(loggedMarkers()).toEqual([]);
  });

  it('обычный ход: поток не начался — печать до заголовков ответа', async () => {
    streamTextMock.mockImplementation(() => ({
      textStream: {
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new RangeError(echo(M_PORTRAIT))) }),
      },
      pipeTextStreamToResponse: vi.fn(),
    }));
    await sendStream();
    expect(loggedText()).toContain('[api/chat] streamText failed before response started: name=RangeError');
    expect(loggedMarkers()).toEqual([]);
  });

  it('служебный generate: классификация остаётся, текст ошибки — нет', async () => {
    vi.mocked(generate).mockRejectedValue(new Error(`OpenRouter 400: ${echo(M_NOTE)}`));
    await expect(chatWithAILogic(ctx(), 'user_audit42', payload())).rejects.toThrow();
    expect(loggedText()).toContain('[chatWithAI] AI request failed (BAD_REQUEST): name=Error');
    expect(loggedMarkers()).toEqual([]);
  });

  // DR-8: новая служебная строка `[chat-end]` — только перечисление и размеры.
  // Проверка двусторонняя: строка обязана появиться (иначе тест пустой),
  // маркеры в ней обязаны отсутствовать.
  it('[chat-end] печатает причину, размеры и счётчики аудита — но не содержимое', async () => {
    const frame = JSON.stringify({ choices: [{ delta: { content: M_NOTE }, finish_reason: 'stop' }] });
    fetchImpl = async () => new Response(sseStream([`data: ${frame}\n\n`, 'data: [DONE]\n\n']), { status: 200 });
    await sendStream({ reasoning: true });
    expect(loggedText()).toContain('[chat-end]');
    expect(loggedMarkers()).toEqual([]);
    const line = logs.find(l => l.includes('[chat-end]')) ?? '';
    const parsed = JSON.parse(line.split('[chat-end]')[1]!.trim()) as Record<string, unknown>;
    // MD-2 и MD-3: ход с материалами дополняет строку четырьмя полями — два
    // булевых и два числа.
    expect(Object.keys(parsed).sort()).toEqual([
      'empty_claim_with_results', 'finish', 'foreign_ids', 'ms', 'note_text_denied', 'out_tokens', 'quote_unquoted',
    ]);
    expect(parsed.finish).toBe('stop');
    expect(parsed.note_text_denied).toBe(false);
    expect(parsed.empty_claim_with_results).toBe(false);
    expect(parsed.foreign_ids).toBe(0);
    expect(parsed.quote_unquoted).toBe(0);
  });

  // MD-2: счётчики включаются — и всё равно не печатают ни ответа, ни текста
  // заметки: в журнал идут только булевы и числа.
  it('[chat-end] при сработавших счётчиках не содержит ни ответа, ни заметки', async () => {
    const answer = `Похоже, «${M_TITLE}» — ${M_NOTE} без текста. Ищи [#5742], и «${M_MEMORY} не повторится к среде».`;
    const frame = JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }] });
    fetchImpl = async () => new Response(sseStream([`data: ${frame}\n\n`, 'data: [DONE]\n\n']), { status: 200 });
    await sendStream({ reasoning: true });
    const line = logs.find(l => l.includes('[chat-end]')) ?? '';
    const parsed = JSON.parse(line.split('[chat-end]')[1]!.trim()) as Record<string, unknown>;
    expect(parsed.note_text_denied).toBe(true);
    expect(parsed.foreign_ids).toBe(1);
    // MD-3: кавычка, собранная из маркеров, засчитана — и ни один маркер не
    // появился в журнале.
    expect(parsed.quote_unquoted).toBe(1);
    expect(loggedMarkers()).toEqual([]);
  });
});

const SUMMARY_JSON = JSON.stringify({
  tone: 'ровный', frequentWords: ['бег'], insights: ['бег держит день'],
  themes: ['бег'], extractedFacts: ['бегает по утрам'],
});

// FX-2: два рода мест, которые чинит партия, — «сырая ошибка» в эндпоинте разбора
// заметки: печать сбоя генерации и печать отказа записи usage (там же `.catch`).
describe('FX-2: разбор заметки печатает форму ошибки, а не её текст', () => {
  const CONTENT = `МАРКЕР-ТЕЛА-ЗАМЕТКИ утрення запись про переезд и работу ${'детали дня. '.repeat(12)}`;

  it('сбой генерации: эхо провайдера с текстом заметки не в журнале', async () => {
    vi.mocked(generate).mockRejectedValue(new Error(`OpenRouter 400: echoed body {"content":"${M_NOTE}"}`) as never);
    await expect(summarizeDocumentLogic(ctx(), 'user_fx2', { content: CONTENT })).rejects.toThrow();
    expect(loggedText()).toContain('[AI summarize] generation failed:');
    expect(loggedMarkers()).toEqual([]);
  });

  it('отказ записи usage: сообщение ошибки базы не в журнале', async () => {
    vi.mocked(generate).mockResolvedValue({ text: SUMMARY_JSON, tokensIn: 10, tokensOut: 10, model: 'test-model' } as never);
    const c = ctx();
    (c.recordUsage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(`db write failed: ${M_MEMORY}`));
    await summarizeDocumentLogic(c, 'user_fx2', { content: CONTENT });
    // .catch висит без await — даём ему свершиться.
    await new Promise(r => setTimeout(r, 0));
    expect(loggedText()).toContain('[AI summarize] usage record failed:');
    expect(loggedMarkers()).toEqual([]);
  });
});
