// R7F-019 (из заказа: «сначала воспроизвести»). Опасение: `res.on('close')`
// делает settle('closed'), `onFinish` делает settle('done', usage), а защёлка
// `isSettled` пропускает первого — и штатно законченный ход попадает в ai_usage
// как chat-stream-abort с оценочными токенами вместо точных.
//
// Проба на настоящем handleChat: на честной последовательности OpenRouter
// (role-delta → содержимое → последний чанк с finish_reason и usage → [DONE])
// окончание потока пишется ДО res.end(), поэтому выигрывает settle('done'), и в
// usage идут точные числа поставщика. Дефект НЕ воспроизвёлся — ни когда 'close'
// приходит следующим тиком (как настоящий Node), ни когда его эмитит end()
// синхронно (как в существующем харнесе chatStreamClose).
//
// Первый прогон дал-таки «chat-stream-abort», и это оказался артефакт фикстуры:
// без finish_reason поставщик сам не договорил, onFinish не вызывается, и аборт
// там стоит по праву. Последний кейс закрепляет именно этот случай, чтобы
// подделка харнесса не прятала настоящий.
//
// Мутация к кейсу 1: убрать `await settlement.settle('done', …)` из onFinish →
// ход записывается аборт-оценкой, кейс красный.
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-16' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-16' }),
    refundDailyLimit: (...a: unknown[]) => refundDaily(...(a as [])),
    refundBulkLimit: (...a: unknown[]) => refundBulk(...(a as [])),
    refundGlobalRequest: (...a: unknown[]) => refundGlobal(...(a as [])),
    recordUsage,
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-10-16', shardId: '0', allowance: 8192 }),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn(),
    isAdmin: vi.fn(),
    checkDailyLimit: vi.fn(),
    getAiConsent: vi.fn().mockResolvedValue({ granted: true }),
    getIndexingConsent: vi.fn().mockResolvedValue({ granted: true }),
  },
}));
vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_r7f019' })) }));

process.env.OPENROUTER_API_KEY = 'test-key';

let sseBody: ReadableStream<Uint8Array>;
const enc = new TextEncoder();
vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody, { status: 200 })));

import { handleChat } from '../chat';

class FakeReq extends EventEmitter {
  method = 'POST';
  constructor(body: unknown) {
    super();
    // readBody слушает 'data'/'end'; эмитим на макротаске, как в chatStreamClose.
    setTimeout(() => {
      this.emit('data', Buffer.from(JSON.stringify(body)));
      this.emit('end');
    }, 0);
  }
}

/**
 * closeMode: 'node' — как настоящий ServerResponse ('close' следующим тиком
 * после end()); 'sync' — как существующий харнесс chatStreamClose. Порядок
 * окончания хода обязан выдерживать оба, поэтому кейс 1 идёт в двух режимах.
 */
let closeMode: 'node' | 'sync' = 'node';

class FakeRes extends EventEmitter {
  headersSent = false;
  statusCode = 0;
  body = '';
  destroyed = false;
  writableEnded = false;
  writeHead(code: number) { this.statusCode = code; this.headersSent = true; return this; }
  write(chunk: string | Uint8Array) {
    this.body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }
  end(chunk?: string) {
    if (chunk) this.body += chunk;
    this.writableEnded = true;
    if (closeMode === 'node') setImmediate(() => this.emit('close'));
    else this.emit('close');
  }
}

const ANSWER = 'Достаточно длинный ответ помощника, чтобы пройти порог возврата слота и быть засчитанным как выданный.';

const roleDelta = 'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n';
const contentDelta = `data: {"choices":[{"index":0,"delta":{"content":"${ANSWER}"}}]}\n\n`;
// Хвост настоящего потока: finish_reason и usage приходят в одном последнем чанке.
const finishDelta = 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":80}}\n\n';
const doneMarker = 'data: [DONE]\n\n';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function request(): FakeReq {
  return new FakeReq({
    personaId: 'cbt',
    messages: [{ role: 'user' as const, content: 'Расскажи про мой день, достаточно длинный вопрос для валидации.' }],
  });
}

async function run(chunks: string[]): Promise<FakeRes> {
  sseBody = streamOf(chunks);
  const res = new FakeRes();
  await handleChat(request() as unknown as IncomingMessage, res as unknown as ServerResponse);
  await new Promise<void>(resolve => setImmediate(resolve));
  return res;
}

function usageFlags(): string[] {
  return recordUsage.mock.calls.map(c => String((c[3] as { fn?: string } | undefined)?.fn ?? (c[2] as { fn?: string } | undefined)?.fn));
}

beforeEach(() => {
  refundDaily.mockClear(); refundBulk.mockClear(); refundGlobal.mockClear(); recordUsage.mockClear();
  vi.mocked(fetch).mockClear();
  closeMode = 'node';
});

describe('R7F-019: штатно законченный ход пишется chat-stream, а не abort', () => {
  for (const mode of ['node', 'sync'] as const) {
    it(`поток поставщика закончен, close в режиме «${mode}»: точный usage и без возврата слота`, async () => {
      closeMode = mode;
      const res = await run([roleDelta, contentDelta, finishDelta, doneMarker]);

      expect(res.body).toContain(ANSWER);
      expect(usageFlags(), 'законченный ход записан не как chat-stream').toEqual(['chat-stream']);
      const call = recordUsage.mock.calls[0] as unknown as [string, number, number];
      expect({ tokensIn: call[1], tokensOut: call[2] }).toEqual({ tokensIn: 120, tokensOut: 80 });
      expect(refundDaily, 'штатный ответ вернул дневной слот').not.toHaveBeenCalled();
    });
  }

  it('фикстура без finish_reason (поставщик не договорил) — аборт; это и есть ловушка харнесса', async () => {
    // Ровно та фикстура, на которой первая проба показала «chat-stream-abort» и
    // которая выглядела как подтверждение R7F-019. Без finish_reason поток
    // оборван на стороне поставщика, onFinish не объявляет ход законченным, и
    // аборт в счётчиках — правда, а не дефект учёта.
    const bare = `data: {"choices":[{"index":0,"delta":{"content":"${ANSWER}"}}]}\n\n`;
    const res = await run([bare, 'data: {"usage":{"prompt_tokens":120,"completion_tokens":80}}\n\n', doneMarker]);

    expect(res.body).toContain(ANSWER);
    expect(usageFlags(), 'оборванный поставщиком поток записан не как аборт').toEqual(['chat-stream-abort']);
  });
});
