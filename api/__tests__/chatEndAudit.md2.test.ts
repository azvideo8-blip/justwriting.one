// MD-2 (0.9.37): счётчики аудита доезжают до строки `[chat-end]` на обеих
// серверных ветках. Обычный ход — на макете streamText (накопление ответа
// происходит в цикле записи, его и проверяем), ветвь рассуждений — на
// управляемом SSE, как в chatEndLog.dr8.
//
// Тело заметки и ответы синтетические: выдуманная авторка, ни строки из живого
// архива. Что журнал не печатает содержимое — проверяет serverLogsPrivacy.audit42.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RELATED_DAYS_HEAD, quoteMaterialsText, unquoteAbsent } from '../../src/shared/ai/quoteGuard';

const { streamTextMock } = vi.hoisted(() => ({ streamTextMock: vi.fn() }));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: streamTextMock.mockImplementation(() => ({ pipeTextStreamToResponse: vi.fn() })) };
});

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-11' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-11' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-10-11', shardId: '0', allowance: 8192 }),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn(),
    isAdmin: vi.fn(),
    checkDailyLimit: vi.fn(),
    getAiConsent: vi.fn().mockResolvedValue({ granted: true }),
    getIndexingConsent: vi.fn().mockResolvedValue({ granted: true }),
  },
}));

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_md2' })) }));

const ATTACHED_DOC = '[#local_v102 · 20261009]\n[Прикрепленная заметка]\n'
  + 'Вера записала: репетиция в четверг, струна лопнула на втором прогоне.';

const NO_RESULTS_DOC = ATTACHED_DOC + '\n\n[Поиск по ВСЕЙ базе (128 заметок) по запросу "концерт" '
  + 'не нашёл подходящих заметок. Скажи, что по этому запросу в базе ничего не нашлось.]';

let infos: string[] = [];

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

/** Макет streamText: отдаёт текст двумя кусками, как живой стрим. */
function mockStreamText(text: string): void {
  const parts = [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))].filter(Boolean);
  let i = 0;
  streamTextMock.mockImplementation(() => ({
    textStream: {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve(i < parts.length
          ? { done: false, value: parts[i++]! }
          : { done: true, value: undefined }),
      }),
    },
    pipeTextStreamToResponse: vi.fn(),
  }));
}

function sse(content: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`));
      controller.enqueue(enc.encode('data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n'));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

let sseContent = '';

// Модуль чата импортируется один раз (без resetModules): иначе фабрика
// `vi.mock('ai')` переписывает реализацию streamText после каждого beforeEach.
process.env.OPENROUTER_API_KEY = 'test-key';
import { handleChat } from '../chat';

beforeEach(() => {
  vi.clearAllMocks();
  infos = [];
  sseContent = 'Похоже, это заголовок без текста. Смотри [#5742].';
  vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
    infos.push(args.map(a => String(a)).join(' '));
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(sseContent), { status: 200 })));
  mockStreamText(sseContent);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function send(extra: Record<string, unknown> = {}): Promise<void> {
  await handleChat(
    new FakeReq({ personaId: 'cbt', messages: [{ role: 'user', content: 'Что с этим делать?' }], ...extra }) as unknown as IncomingMessage,
    new FakeRes() as unknown as ServerResponse,
  );
}

function endLine(): Record<string, unknown> {
  const line = infos.find(l => l.includes('[chat-end]'));
  if (!line) throw new Error('строка [chat-end] не написана');
  return JSON.parse(line.split('[chat-end]')[1]!.trim()) as Record<string, unknown>;
}

describe('MD-2: аудит в [chat-end]', () => {
  it('обычный ход: приложенная заметка + «текста нет» + выдуманный номер', async () => {
    await send({ documentContent: ATTACHED_DOC });
    expect(endLine()).toMatchObject({
      note_text_denied: true,
      empty_claim_with_results: false,
      foreign_ids: 1,
      quote_unquoted: 0,
    });
  });

  it('ветвь рассуждений: те же счётчики по каналу ответа', async () => {
    await send({ documentContent: ATTACHED_DOC, reasoning: true });
    expect(endLine()).toMatchObject({
      note_text_denied: true,
      empty_claim_with_results: false,
      foreign_ids: 1,
      quote_unquoted: 0,
    });
  });

  // MD-3: счётчик снятых кавычек живёт в той же строке.
  it('обычный ход: кавычка вне материалов засчитана', async () => {
    const answer = 'Соня сказала «я не хочу ехать на этот концерт», и замолчала.';
    mockStreamText(answer);
    await send({ documentContent: ATTACHED_DOC });
    expect(endLine()).toMatchObject({ quote_unquoted: 1 });
  });

  it('ветвь рассуждений: кавычка из реплики человека не засчитана', async () => {
    // Материалы сверки — ограда данных + память + реплики хода, как `materialsText`
    // на клиенте: цитата человека остаётся цитатой.
    const userLine = 'Она мне ответила «держись, разберёмся в четверг», а я молчу.';
    sseContent = 'Ты ей: «держись, разберёмся в четверг».';
    await send({ documentContent: ATTACHED_DOC, reasoning: true, messages: [{ role: 'user', content: userLine }] });
    expect(endLine()).toMatchObject({ quote_unquoted: 0 });
  });

  // DY7-7: сервер считает снятые кавычки по тому же собранию, что и страж
  // клиента (`quoteMaterialsText`). В строгом ходе фон — пересказ ИИ, кавычка
  // из него снимается у человека, значит засчитана и в журнале. Мутация: вернуть
  // серверу прежнее собрание (вся ограда данных) → 1 вместо 2.
  it('строгий ход: кавычка из фона засчитана так же, как на клиенте', async () => {
    const doc = '[Сегодня: вторник]\n\n' + RELATED_DAYS_HEAD
      + '\n[#local_bg77 · 2026-10-01 · за 8 дн. до этой заметки] Вера сдала скрипку в ремонт и ждала мастера неделю.\n\n'
      + ATTACHED_DOC;
    const answer = 'Ты пишешь: «струна лопнула на втором прогоне». '
      + 'Раньше было: «сдала скрипку в ремонт и ждала мастера неделю». '
      + 'И ещё: «я больше никогда не возьму смычок в руки».';
    mockStreamText(answer);
    const messages = [{ role: 'user', content: 'Что с этим делать?' }];
    await send({ documentContent: doc, noteScope: { mode: 'note', title: 'репетиция', date: '' }, messages });
    const client = unquoteAbsent(answer, quoteMaterialsText({ strict: true, documentContent: doc, humanTurns: messages.map(m => m.content) })).stripped.length;
    expect(client).toBe(2);
    expect(endLine()).toMatchObject({ quote_unquoted: client });
  });

  it('законное «ничего не нашлось» при пустом блоке не считается', async () => {
    const answer = 'По этому запросу в базе ничего не нашлось.';
    mockStreamText(answer);
    await send({ documentContent: NO_RESULTS_DOC });
    expect(endLine()).toMatchObject({ empty_claim_with_results: false, note_text_denied: false });
  });

  it('ход без материалов: состав строки прежний (закреплено в chatEnd.dr8)', async () => {
    await send();
    expect(Object.keys(endLine()).sort()).toEqual(['finish', 'ms', 'out_tokens']);
  });
});
