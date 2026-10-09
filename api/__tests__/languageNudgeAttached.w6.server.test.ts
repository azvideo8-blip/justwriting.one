// W-6 (сервер): язык ответа решается по вопросу, а не по ходу с вложением
// целиком. Скопированный случай из матрицы §4.1 (requestMatrix.audit41,
// режим englishWithAttachment) проигран здесь на настоящем handleChat: на базе
// подсказка не ставилась, потому что в последней реплике лежала русская заметка.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const { streamTextMock, tryReserve, generateMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  tryReserve: vi.fn(),
  generateMock: vi.fn(),
}));

vi.mock('../ai/provider', () => ({
  generate: generateMock,
  getActiveModel: vi.fn().mockResolvedValue('test-model'),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: streamTextMock.mockImplementation(() => ({ pipeTextStreamToResponse: vi.fn() })),
  };
});

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-09' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-09' }),
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

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_w6' })) }));

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';
import { chatWithAILogic } from '../ai/chatWithAI.logic';
import { ATTACHED_QUESTION_SEP } from '../../src/shared/ai/languageNudge';
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
  writeHead(code: number) { this.statusCode = code; this.headersSent = true; return this; }
  write(chunk: string | Uint8Array) { this.body += String(chunk); return true; }
  end(chunk?: string) { if (chunk) this.body += String(chunk); this.ended = true; this.emit('close'); }
}

// Синтетика: название и текст заметки выдуманы.
const RU_NOTE = '[Прикреплена заметка: "Кухня и ремонт"]\n\nОтложили кухню на осень, подрядчик обещал в четверг, я не настаивала.';
const EN_QUESTION = 'what do you think about postponing the kitchen repair?';

async function lastProviderMessage(content: string): Promise<string> {
  streamTextMock.mockClear();
  const req = new FakeReq({ personaId: 'coach', messages: [{ role: 'user', content }] });
  await handleChat(req as unknown as IncomingMessage, new FakeRes() as unknown as ServerResponse);
  const sent = (streamTextMock.mock.calls[0]?.[0] ?? {}) as { messages?: Array<{ role: string; content: string }> };
  const msgs = sent.messages ?? [];
  return msgs[msgs.length - 1]?.content ?? '';
}

describe('W-6: сервер выбирает язык по вопросу', () => {
  beforeEach(() => {
    tryReserve.mockReset();
    tryReserve.mockResolvedValue({ date: '2026-10-09', shardId: '0', allowance: 3000 });
  });

  it('английский вопрос с приложенной русской заметкой получает английский ответ', async () => {
    const last = await lastProviderMessage(`${RU_NOTE}${ATTACHED_QUESTION_SEP}${EN_QUESTION}`);
    expect(last.endsWith('(Answer in English.)')).toBe(true);
  });

  it('вопрос без вложения работает как раньше', async () => {
    expect((await lastProviderMessage(EN_QUESTION)).endsWith('(Answer in English.)')).toBe(true);
    expect((await lastProviderMessage('хочу бегать по утрам, с чего начать?')).includes('Answer in English')).toBe(false);
  });

  it('нерассуждающий endpoint: тот же ход получает подсказку в generate', async () => {
    generateMock.mockResolvedValue({ text: 'ответ', tokensIn: 1, tokensOut: 1, model: 'test-model' });
    const ctx = {
      checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-09' }),
      checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-09' }),
      refundDailyLimit: vi.fn().mockResolvedValue(undefined),
      refundBulkLimit: vi.fn().mockResolvedValue(undefined),
      tryReserveGlobalRequest: vi.fn().mockResolvedValue({ id: 'res_w6' }),
      refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
      recordUsage: vi.fn().mockResolvedValue(undefined),
      recordDailySpendRub: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof chatWithAILogic>[0];
    await chatWithAILogic(ctx, 'u_w6', {
      personaId: 'coach',
      messages: [{ role: 'user', content: `${RU_NOTE}${ATTACHED_QUESTION_SEP}${EN_QUESTION}` }],
    });
    const args = generateMock.mock.calls[0]?.[0] as { messages?: Array<{ role: string; content: string }> };
    const last = (args.messages ?? []).at(-1)?.content ?? '';
    expect(last.endsWith('(Answer in English.)')).toBe(true);
  });

  it('русский вопрос про английскую заметку остаётся без подсказки', async () => {
    const note = '[Прикреплена заметка: "Kitchen and repair"]\n\nWe postponed the kitchen refurb, the contractor promised Thursday.';
    const last = await lastProviderMessage(`${note}${ATTACHED_QUESTION_SEP}что я думала про откладку ремонта?`);
    expect(last.includes('Answer in English')).toBe(false);
  });
});
