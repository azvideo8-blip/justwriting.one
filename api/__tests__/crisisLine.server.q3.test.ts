// R-6 (ревью 07.10): кризисный флаг Q-3 был доказан с двух концов — на сборке
// промпта и на теле клиента, — но через handleChat не прогонялся. Здесь ровно то,
// что видит провайдер: строка кризиса инструкцией и до первого data-fence.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const { streamTextMock, tryReserve, generateMock } = vi.hoisted(() => ({
  streamTextMock: vi.fn(), tryReserve: vi.fn(), generateMock: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    streamText: streamTextMock.mockImplementation(() => ({ pipeTextStreamToResponse: vi.fn() })),
  };
});

// П6 (самопроверка): тот же сигнал проверяется и на втором сервере — вызываемом
// маршруте chatWithAI, а не только на потоковом.
vi.mock('../ai/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/provider')>();
  return { ...actual, generate: (...a: unknown[]) => generateMock(...(a as [])) };
});

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-07' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-07' }),
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

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_q3' })) }));

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';
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

const CRISIS = 'ЭТОТ ХОД — КРИЗИСНЫЙ';
const FENCE = 'DATA_CONTEXT_BEGIN';
const TURN = [{ role: 'user', content: 'мне не хочется просыпаться по утрам' }];

async function sentSystem(overrides: Record<string, unknown> = {}): Promise<string> {
  streamTextMock.mockClear();
  const req = new FakeReq({ personaId: 'cbt', messages: TURN, documentContent: 'Сегодня опять не спалось.', ...overrides });
  await handleChat(req as unknown as IncomingMessage, new FakeRes() as unknown as ServerResponse);
  return String(streamTextMock.mock.calls[0]?.[0]?.system ?? '');
}

async function reasoningSystem(): Promise<string> {
  const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: unknown }) => new Response('data: [DONE]\n\n', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const req = new FakeReq({ personaId: 'cbt', reasoning: true, crisis: true, messages: TURN, documentContent: 'Сегодня опять не спалось.' });
    await handleChat(req as unknown as IncomingMessage, new FakeRes() as unknown as ServerResponse);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages?: Array<{ role: string; content: string }>;
    };
    return (body.messages ?? []).filter(m => m.role === 'system').map(m => m.content).join('\n');
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('Q-3/R-6: кризисный сигнал в запросе провайдеру', () => {
  beforeEach(() => {
    tryReserve.mockReset();
    tryReserve.mockResolvedValue({ date: '2026-10-07', shardId: '0', allowance: 8192 });
  });

  it('crisis: true — строка есть и стоит до первого фенса', async () => {
    const system = await sentSystem({ crisis: true });
    expect(system).toContain(CRISIS);
    expect(system.indexOf(CRISIS)).toBeLessThan(system.indexOf(FENCE));
  });

  it('без поля crisis — строки нет', async () => {
    expect(await sentSystem()).not.toContain(CRISIS);
  });

  it('crisis: false — строки нет', async () => {
    expect(await sentSystem({ crisis: false })).not.toContain(CRISIS);
  });

  it('режим рассуждений — то же место вне фенса', async () => {
    const system = await reasoningSystem();
    expect(system).toContain(CRISIS);
    expect(system.indexOf(CRISIS)).toBeLessThan(system.indexOf(FENCE));
  });
});

// П6: вызываемый маршрут (functions chatWithAI) собирается теми же
// `assembleChatPromptParams`, но проверялся только потоковый.
describe('Q-3/R-6: тот же сигнал на вызываемом маршруте', () => {
  beforeEach(() => {
    generateMock.mockReset();
    generateMock.mockResolvedValue({ text: 'ок', tokensIn: 10, tokensOut: 5, model: 'm' });
  });

  async function sentSystemCallable(data: Record<string, unknown>): Promise<string> {
    const { chatWithAILogic } = await import('../ai/chatWithAI.logic');
    const ctx = {
      checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-07' }),
      checkDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-07' }),
      checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-07' }),
      refundDailyLimit: vi.fn().mockResolvedValue(undefined),
      refundBulkLimit: vi.fn().mockResolvedValue(undefined),
      refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
      tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-10-07', shardId: '0', allowance: 8192 }),
      recordUsage: vi.fn().mockResolvedValue(undefined),
      getDailyLimitCount: vi.fn(),
      getUserDailyLimit: vi.fn().mockResolvedValue(20),
      isAdmin: vi.fn().mockResolvedValue(false),
    } as never;
    await chatWithAILogic(ctx, 'u_q3', { personaId: 'cbt', messages: TURN, documentContent: 'Сегодня опять не спалось.', ...data });
    return String(generateMock.mock.calls[0]?.[0]?.system ?? '');
  }

  it('crisis: true — строка есть и стоит до первого фенса', async () => {
    const system = await sentSystemCallable({ crisis: true });
    expect(system).toContain(CRISIS);
    expect(system.indexOf(CRISIS)).toBeLessThan(system.indexOf(FENCE));
  });

  it('без поля crisis — строки нет', async () => {
    expect(await sentSystemCallable({})).not.toContain(CRISIS);
  });
});
