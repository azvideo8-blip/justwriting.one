// X-3: резерв глобального котла обязан считаться тем промптом, который сервер
// реально соберёт для провайдера. До правки в оценку попадали только поля запроса
// (заметка, портрет, память, кастомная персона), а шаблон персоны с guard'ами
// добавлялся поверх: ход «привет» резервировал ~1 065 токена против 2 997
// списанных — котёл недооценивался втрое.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let randomSpy: { mockRestore: () => void } | undefined;
import { EventEmitter } from 'events';

const { tryReserve } = vi.hoisted(() => ({ tryReserve: vi.fn() }));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: vi.fn(() => ({ pipeTextStreamToResponse: vi.fn() })) };
});

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-06' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-06' }),
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

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_x3' })) }));

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';
import { buildChatSystemPrompt, assembleChatPromptParams, REASONING_LANGUAGE_RULE } from '../../src/shared/ai/buildChatPrompt.js';
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

// Синтетический контекст светского хода: блок «что ты писал недавно» с тремя
// заметками, портрет и память. Имена и тексты выдуманы.
const CONTEXT = '[Что ты писал недавно]\n'
  + Array.from({ length: 3 }, (_, i) => `— «Заметка ${i}»: краткий разбор про работу, сон и обещания себе. `.repeat(6)).join('\n')
  + '\n\n[Возможно релевантные заметки]\n'
  + Array.from({ length: 3 }, (_, i) => `[#doc_${i} · 2026100${i}]\nЗаметка ${i}: «Осень»\nТекст куска про утро и бег. `.repeat(8)).join('\n\n');

const turnPayload = {
  personaId: 'cbt',
  messages: [{ role: 'user', content: 'привет' }],
  documentContent: CONTEXT,
  userPortrait: 'Портрет: ' + 'текст профиля. '.repeat(80),
  memoryContext: 'Память диалога: ' + 'строка памяти. '.repeat(40),
  documentMood: 'спокойно',
};

// Максимум вывода внешнего хода без рассуждения (getMaxTokens).
const MAX_OUTPUT_TOKENS = 8192;

describe('X-3: резерв включает собранный системный промпт', () => {
  beforeEach(() => {
    tryReserve.mockReset();
    tryReserve.mockResolvedValue({ date: '2026-10-06', shardId: '0', allowance: 8192 });
    // DLG-Q2: подборка примеров открытых вопросов меняется от хода к ходу. Тест
    // сверяет резерв с промптом, который пересобирает сам, поэтому случайность
    // должна быть общей и детерминированной — иначе длины разъезжаются.
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    randomSpy?.mockRestore();
  });

  it('зарезервированный вход покрывает промпт, который уйдёт провайдеру', async () => {
    const req = new FakeReq(turnPayload);
    const res = new FakeRes();
    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(tryReserve).toHaveBeenCalledTimes(1);
    const allowance = tryReserve.mock.calls[0]![0] as number;
    const reservedInput = allowance - MAX_OUTPUT_TOKENS;

    // Эталон — тот же промпт, что собирает сервер для этого запроса.
    const system = buildChatSystemPrompt(assembleChatPromptParams(turnPayload as never));
    const expected = Math.ceil((system.length + 'привет'.length) / 3);

    expect(reservedInput, 'резерв не покрывает собранный промпт').toBeGreaterThanOrEqual(expected);
    expect(reservedInput, 'резерв считает те же поля дважды поверх промпта')
      .toBeLessThanOrEqual(expected + 1);
  });

  it('ход с рассуждением резервирует и правило о языке рассуждений', async () => {
    const req = new FakeReq({ ...turnPayload, reasoning: true });
    const res = new FakeRes();
    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    const allowance = tryReserve.mock.calls[0]![0] as number;
    // У хода с рассуждением бюджет ответа другой (getMaxTokens: 16 384).
    const reservedInput = allowance - 16_384;
    const reasoningPrompt = buildChatSystemPrompt({ ...assembleChatPromptParams(turnPayload as never), reasoning: true });
    // Правило о языке рассуждений добавляется к промпту в withReasoningLanguage —
    // оно тоже уйдёт провайдеру и должно стоять в резерве.
    const expected = Math.ceil((reasoningPrompt.length + REASONING_LANGUAGE_RULE.length + 2 + 'привет'.length) / 3);
    expect(reservedInput, 'резерв рассуждения не покрывает промпт с правилом языка').toBeGreaterThanOrEqual(expected);
  });
});
