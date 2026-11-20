// К28-2 (владелец 20.11): в ход положена строка итога — в `[chat-end]` метка
// summary=ok|miss, дал ли ответ итог с проверкой «верно ли». На обеих ветках
// (обычный ход и рассуждения), и в ходе без материалов (аудит пустой).
// Мутации: (1) не добавлять summary в ответ аудита → красные 1–3, 5;
// (2) summary всегда 'ok' → красный 2; (3) ставить summary без строки итога → красный 4.
// Синтетика: ни строки из живого архива.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'node:http';

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

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_k28' })) }));

const ATTACHED_DOC = '[#local_v102 · 20261009]\n[Прикрепленная заметка]\n'
  + 'Вера записала: репетиция в четверг, струна лопнула на втором прогоне.';


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


const Q = 'Что ты чувствуешь, когда думаешь об этом?';
// Три ответа подряд кончаются вопросом, человек ничего не спрашивает — строка итога.
const SUMMARY_HISTORY = [
  { role: 'user', content: 'Разбери эту запись.' },
  { role: 'assistant', content: 'Похоже, тебе трудно остановиться. ' + Q },
  { role: 'user', content: 'Наверное, боюсь, что всё развалится.' },
  { role: 'assistant', content: 'Слышу страх. А что было бы, если бы ты остановилась?' },
  { role: 'user', content: 'Не знаю, просто спокойнее, когда всё сделано.' },
  { role: 'assistant', content: 'Спокойнее на минуту. Как долго держится это спокойствие?' },
  { role: 'user', content: 'Да, недолго.' },
];
const SUMMARY_ANSWER = 'Соберу, к чему мы пришли: ты боишься, что всё развалится, и спокойнее, когда всё сделано, но ненадолго. Верно ли я собрала? Можем продолжить или остановиться на этом.';
const MISS_ANSWER = 'Это интересно. А откуда, как думаешь, взялось это правило?';

describe('К28-2: метка итога в [chat-end]', () => {
  it('1: обычный ход, строка итога, ответ с итогом → summary=ok', async () => {
    mockStreamText(SUMMARY_ANSWER);
    await send({ documentContent: ATTACHED_DOC, messages: SUMMARY_HISTORY });
    expect(endLine()).toMatchObject({ summary: 'ok' });
  });

  it('2: обычный ход, строка итога, ответ новым вопросом → summary=miss', async () => {
    mockStreamText(MISS_ANSWER);
    await send({ documentContent: ATTACHED_DOC, messages: SUMMARY_HISTORY });
    expect(endLine()).toMatchObject({ summary: 'miss' });
  });

  it('3: ветвь рассуждений → та же метка', async () => {
    sseContent = SUMMARY_ANSWER;
    await send({ documentContent: ATTACHED_DOC, messages: SUMMARY_HISTORY, reasoning: true });
    expect(endLine()).toMatchObject({ summary: 'ok' });
  });

  it('4: строки итога не было → поля summary нет', async () => {
    mockStreamText(SUMMARY_ANSWER);
    await send({ documentContent: ATTACHED_DOC, messages: SUMMARY_HISTORY.slice(0, 3) });
    expect(endLine()).not.toHaveProperty('summary');
  });

  it('5: ход без материалов (аудита нет) — метка всё равно есть', async () => {
    mockStreamText(MISS_ANSWER);
    await send({ messages: SUMMARY_HISTORY });
    expect(endLine()).toMatchObject({ summary: 'miss' });
  });
});
