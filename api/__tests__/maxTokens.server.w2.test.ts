// W-2 (сервер): потолок вывода доезжает до поставщика на обоих путях и в нём же
// считается резерв. До правки и туда, и туда шло 8 192 независимо от выбранной
// человеком длины ответа.
//
// Мутация: игнорировать responseLength в getMaxTokens → краснеют оба теста.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const { streamTextMock, tryReserve, generateMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(),
  tryReserve: vi.fn(),
  generateMock: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: streamTextMock.mockImplementation(() => ({ pipeTextStreamToResponse: vi.fn() })),
  };
});

vi.mock('../ai/provider', () => ({
  generate: generateMock,
  getActiveModel: vi.fn().mockResolvedValue('test-model'),
}));

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

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_w2' })) }));

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';
import { chatWithAILogic } from '../ai/chatWithAI.logic';
import { estimateInputTokens, getMaxTokens } from '../../src/shared/ai/aiPolicy';
import type { AiContext } from '../../src/shared/ai/context.js';
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

type Sent = { system?: string; messages?: Array<{ role: string; content: string }>; maxOutputTokens?: number };

const TURN = [{ role: 'user', content: 'расскажи про осень' }];

async function sendStream(overrides: Record<string, unknown> = {}): Promise<Sent> {
  streamTextMock.mockClear();
  const req = new FakeReq({ personaId: 'coach', messages: TURN, ...overrides });
  await handleChat(req as unknown as IncomingMessage, new FakeRes() as unknown as ServerResponse);
  return (streamTextMock.mock.calls[0]?.[0] ?? {}) as Sent;
}

function logicCtx() {
  return {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-09' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-09' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ id: 'res_w2' }),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    recordDailySpendRub: vi.fn().mockResolvedValue(undefined),
  } as unknown as AiContext & { tryReserveGlobalRequest: ReturnType<typeof vi.fn> };
}

describe('W-2: потолок ответа на сервере следует за выбранной длиной', () => {
  beforeEach(() => {
    tryReserve.mockReset();
    tryReserve.mockResolvedValue({ date: '2026-10-09', shardId: '0', allowance: 700 });
    generateMock.mockResolvedValue({ text: 'ответ', tokensIn: 10, tokensOut: 10, model: 'test-model' });
  });

  it('поточный ход «кратко»: поставщик получает 700, резерв = вход + 700', async () => {
    const sent = await sendStream({ responseLength: 'short' });
    expect(sent.maxOutputTokens).toBe(700);
    const estimate = estimateInputTokens([sent.system ?? '', ...(sent.messages ?? []).map(m => m.content)]);
    const allowance = tryReserve.mock.calls[0]?.[0] as number;
    expect(allowance).toBe(getMaxTokens(false, false, undefined, 'short') + estimate);
    expect(allowance).toBe(700 + estimate);
  });

  it('поточный ход без выбранной длины получает потолок detailed', async () => {
    const sent = await sendStream();
    expect(sent.maxOutputTokens).toBe(3000);
  });

  it('служебный ход остаётся на своём потолке', async () => {
    const sent = await sendStream({ callType: 'auto_name', responseLength: 'short' });
    expect(sent.maxOutputTokens).toBe(256);
  });

  // DL-19 (владелец 25.10): длинное вложение — потолок вдвое и в резерве, в обоих путях.
  // Мутация: не передавать isLongNoteTurn в getMaxTokens (любой из двух путей) → красный.
  it('поточный ход с длинным вложением: 6 000 и резерв = вход + 6 000; у Редактора — нет', async () => {
    const sent = await sendStream({ documentContent: 'вечер у окна. '.repeat(1200) });
    expect(sent.maxOutputTokens).toBe(6000);
    const estimate = estimateInputTokens([sent.system ?? '', ...(sent.messages ?? []).map(m => m.content)]);
    expect(tryReserve.mock.calls.at(-1)?.[0]).toBe(6000 + estimate);
    expect((await sendStream({ personaId: 'editor', documentContent: 'вечер у окна. '.repeat(1200) })).maxOutputTokens).toBe(3000);
  });

  it('ход без потока с длинным вложением: generate получает 6 000', async () => {
    const ctx = logicCtx();
    await chatWithAILogic(ctx, 'u_w2', { personaId: 'coach', messages: TURN, documentContent: 'вечер у окна. '.repeat(1200) });
    expect((generateMock.mock.calls.at(-1)?.[0] as { maxTokens?: number }).maxTokens).toBe(6000);
    generateMock.mockClear();
  });

  it('обычный ход: generate получает 700, резерв = вход + 700', async () => {
    const ctx = logicCtx();
    await chatWithAILogic(ctx, 'u_w2', { personaId: 'coach', messages: TURN, responseLength: 'short' });
    const args = generateMock.mock.calls[0]?.[0] as {
      system?: string;
      messages?: Array<{ role: string; content: string }>;
      maxTokens?: number;
    };
    expect(args.maxTokens).toBe(700);
    const estimate = estimateInputTokens([args.system ?? '', ...(args.messages ?? []).map(m => m.content)]);
    expect(ctx.tryReserveGlobalRequest.mock.calls[0]?.[0]).toBe(700 + estimate);
  });
});
