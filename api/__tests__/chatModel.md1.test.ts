// MD-1 (0.9.37): у живого диалога своя модель, у служебных вызовов — прежняя.
//
// До правки один env (`OPENROUTER_MODEL`) двигал всё: чат, саммари, пунктуацию,
// ранжирование, профиль. Замер стенда arch-2026-10-11 показал, что чату нужна
// `deepseek/deepseek-v4.1-flash` (39 % провалов против 24 % на v4-flash), а
// служебные вызовы не измерялись вовсе. Значит — отдельный `AI_CHAT_MODEL`, и
// проверка обязана различать два контура: что бы ни стояло в `OPENROUTER_MODEL`,
// чат идёт по своему значению, а что бы ни стояло в `AI_CHAT_MODEL`, служебные
// вызовы идут по своему.
//
// Ветку рассуждений и ordinary-стрим видно по телу запроса, которое уходит
// поставщику: оно перехвачено на `fetch`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AiContext } from '../../src/shared/ai/context.js';

const CHAT_DEFAULT = 'deepseek/deepseek-v4.1-flash';
const SERVICE_DEFAULT = 'deepseek/deepseek-v4-flash';

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

vi.mock('../auth', () => ({ requireSession: vi.fn(async () => ({ uid: 'u_md1' })) }));

const ORIGINAL_ENV = { ...process.env };

/** Тела запросов, ушедшие «поставщику» за текущий тест. */
let sentBodies: Record<string, unknown>[] = [];

function sse(content: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sentBodies = [];
  process.env = { ...ORIGINAL_ENV, OPENROUTER_API_KEY: 'test-key' };
  delete process.env.AI_CHAT_MODEL;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_PROVIDER_COUNTRY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

function stubSseFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
    sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return new Response(sse('Ответ модели для теста модели хода.'), { status: 200 });
  }));
}

function stubJsonFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
    sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ок' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    };
  }));
}

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

const plainBody = {
  personaId: 'cbt',
  messages: [{ role: 'user' as const, content: 'Немного текста про день, достаточно длинного для валидации.' }],
};
const reasoningBody = { ...plainBody, reasoning: true };

async function runChat(body: unknown): Promise<void> {
  const { handleChat } = await import('../chat');
  const res = new FakeRes();
  await handleChat(new FakeReq(body) as unknown as IncomingMessage, res as unknown as ServerResponse);
}

function firstModel(): string {
  const body = sentBodies[0];
  if (!body) throw new Error('поставщик не вызван — тело запроса не перехвачено');
  return String(body.model);
}

describe('MD-1: чат идёт на своей модели', () => {
  it('обычный ход: по умолчанию deepseek-v4.1-flash', async () => {
    stubSseFetch();
    await runChat(plainBody);
    expect(firstModel()).toBe(CHAT_DEFAULT);
  });

  it('обычный ход: берёт AI_CHAT_MODEL, а не OPENROUTER_MODEL', async () => {
    process.env.OPENROUTER_MODEL = 'service/other-model';
    process.env.AI_CHAT_MODEL = 'chat/own-model';
    stubSseFetch();
    await runChat(plainBody);
    expect(firstModel()).toBe('chat/own-model');
  });

  it('ветвь рассуждений: тот же чат-модельный slug', async () => {
    process.env.OPENROUTER_MODEL = 'service/other-model';
    stubSseFetch();
    await runChat(reasoningBody);
    expect(firstModel()).toBe(CHAT_DEFAULT);
    expect(sentBodies[0]).toMatchObject({ reasoning: { effort: 'low' } });
  });

  it('фолбэк chatWithAI отвечает той же моделью, что и стрим', async () => {
    process.env.OPENROUTER_MODEL = 'service/other-model';
    stubJsonFetch();
    const { chatWithAILogic } = await import('../ai/chatWithAI.logic');
    const ctx = {
      checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-11' }),
      refundDailyLimit: vi.fn().mockResolvedValue(undefined),
      checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-11' }),
      refundBulkLimit: vi.fn().mockResolvedValue(undefined),
      tryReserveGlobalRequest: vi.fn().mockResolvedValue({ id: 'res_md1' }),
      refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
      recordUsage: vi.fn().mockResolvedValue(undefined),
      recordDailySpendRub: vi.fn().mockResolvedValue(undefined),
    } as unknown as AiContext;
    await chatWithAILogic(ctx, 'u_md1', plainBody);
    expect(firstModel()).toBe(CHAT_DEFAULT);
  });
});

describe('MD-1: служебные вызовы остались на OPENROUTER_MODEL', () => {
  // Ревью MD-1: служебный вызов через маршрут чата (название диалога) — не живой
  // диалог; на новой модели он не мерился и остаётся на модели generate().
  // Мутация: выбирать модель без учёта isInternalCall → оба случая красные.
  it('служебный вызов через стрим чата (auto_name) идёт на OPENROUTER_MODEL', async () => {
    stubSseFetch();
    await runChat({ personaId: 'coach', callType: 'auto_name', messages: [{ role: 'user', content: 'Придумай название для разговора про планы.' }] });
    expect(firstModel()).toBe(SERVICE_DEFAULT);
  });

  it('служебный вызов через фолбэк chatWithAI идёт на OPENROUTER_MODEL', async () => {
    stubJsonFetch();
    const { chatWithAILogic } = await import('../ai/chatWithAI.logic');
    const ctx = {
      checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-11' }),
      refundDailyLimit: vi.fn().mockResolvedValue(undefined),
      checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-11' }),
      refundBulkLimit: vi.fn().mockResolvedValue(undefined),
      tryReserveGlobalRequest: vi.fn().mockResolvedValue({ id: 'res_md1' }),
      refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
      recordUsage: vi.fn().mockResolvedValue(undefined),
      recordDailySpendRub: vi.fn().mockResolvedValue(undefined),
    } as unknown as AiContext;
    await chatWithAILogic(ctx, 'u_md1', { personaId: 'coach', callType: 'auto_name', messages: [{ role: 'user', content: 'Придумай название для разговора про планы.' }] });
    expect(firstModel()).toBe(SERVICE_DEFAULT);
  });

  it('generate() без явной модели: прежний дефолт v4-flash', async () => {
    stubJsonFetch();
    const { generate } = await import('../ai/provider');
    const res = await generate({ messages: [{ role: 'user', content: 'расставь знаки' }] });
    expect(firstModel()).toBe(SERVICE_DEFAULT);
    expect(res.model).toBe(SERVICE_DEFAULT);
  });

  it('generate() берёт OPENROUTER_MODEL и не смотрит на AI_CHAT_MODEL', async () => {
    process.env.OPENROUTER_MODEL = 'service/other-model';
    process.env.AI_CHAT_MODEL = 'chat/own-model';
    stubJsonFetch();
    const { generate } = await import('../ai/provider');
    await generate({ messages: [{ role: 'user', content: 'расставь знаки' }] });
    expect(firstModel()).toBe('service/other-model');
  });

  it('эталонное тело (харнесы) по-прежнему считает модель по OPENROUTER_MODEL', async () => {
    const { buildChatRequestBody, resolveChatModel, resolveAiChatModel } = await import('../../src/shared/ai/requestConfig.js');
    expect(resolveChatModel()).toBe(SERVICE_DEFAULT);
    expect(resolveAiChatModel()).toBe(CHAT_DEFAULT);
    expect(buildChatRequestBody({ messages: [{ role: 'user', content: 'x' }] })).toMatchObject({ model: SERVICE_DEFAULT });
  });
});
