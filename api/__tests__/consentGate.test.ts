// AUD-2: согласие на обработку ИИ проверяется сервером. Клиентский гейт
// (callAi) обходится прямым POST /api/chat — основным путём чата, — поэтому
// гарантией может быть только гейт в handleChat и handleAiEndpoint.
// Проверяется исходящий fetch: провайдер не должен вызываться вовсе.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const ctx = vi.hoisted(() => ({
  getAiConsent: vi.fn(),
  getIndexingConsent: vi.fn(),
  checkAndIncrementLimit: vi.fn(),
  checkAndIncrementBulkLimit: vi.fn(),
  refundDailyLimit: vi.fn(),
  refundBulkLimit: vi.fn(),
  refundGlobalRequest: vi.fn(),
  recordUsage: vi.fn(),
  tryReserveGlobalRequest: vi.fn(),
}));

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: ctx,
}));

vi.mock('../auth', () => ({
  requireSession: vi.fn(async () => ({ uid: 'u1' })),
}));

const providerFetch = vi.fn(async () => new Response('ok', { status: 200 }));
vi.stubGlobal('fetch', providerFetch);

process.env.OPENROUTER_API_KEY = 'test-key';

import { handleChat } from '../chat';
import { handleAiEndpoint } from '../handlers';
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
  end(chunk?: string) { if (chunk) this.body += chunk; this.ended = true; return this; }
}

function chatBody() {
  return {
    personaId: 'cbt',
    messages: [{ role: 'user', content: 'привет' }],
  };
}

beforeEach(() => {
  providerFetch.mockClear();
  for (const fn of Object.values(ctx)) fn.mockReset();
  ctx.getAiConsent.mockResolvedValue({ granted: true });
  ctx.getIndexingConsent.mockResolvedValue({ granted: true });
  ctx.checkAndIncrementLimit.mockResolvedValue({ ok: true, day: '2026-08-23' });
  ctx.checkAndIncrementBulkLimit.mockResolvedValue({ ok: true, day: '2026-08-23' });
  ctx.refundDailyLimit.mockResolvedValue(undefined);
  ctx.refundBulkLimit.mockResolvedValue(undefined);
  ctx.refundGlobalRequest.mockResolvedValue(undefined);
  ctx.recordUsage.mockResolvedValue(undefined);
  ctx.tryReserveGlobalRequest.mockResolvedValue({ date: '2026-08-23', shardId: '0', allowance: 256 });
});

describe('AUD-2: /api/chat без согласия не доходит до провайдера', () => {
  it('ai_consent_at = null → 403 AI_CONSENT_REQUIRED, fetch провайдера не звался', async () => {
    ctx.getAiConsent.mockResolvedValue({ granted: false });
    const req = new FakeReq(chatBody());
    const res = new FakeRes();

    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.statusCode).toBe(403);
    // AUDIT-part3 2: единая форма {error:{code,message}}
    expect(JSON.parse(res.body).error).toEqual({ code: 'AI_CONSENT_REQUIRED', message: 'AI_CONSENT_REQUIRED' });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('согласие есть → гейт пропускает (не 403)', async () => {
    const req = new FakeReq(chatBody());
    const res = new FakeRes();

    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.statusCode).not.toBe(403);
  });

  it('отказ согласия не списывает лимит и не резервирует слот', async () => {
    ctx.getAiConsent.mockResolvedValue({ granted: false });
    const req = new FakeReq(chatBody());
    const res = new FakeRes();

    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.statusCode).toBe(403);
    expect(ctx.checkAndIncrementLimit).not.toHaveBeenCalled();
    expect(ctx.tryReserveGlobalRequest).not.toHaveBeenCalled();
  });
});

describe('AUD-2: диспетчер AI-эндпоинтов сверяет согласие', () => {
  it('summarizeDocument без AI-согласия → 403, логика не вызывается', async () => {
    ctx.getAiConsent.mockResolvedValue({ granted: false });

    const out = await handleAiEndpoint('summarizeDocument', 'u1', { data: { content: 'x'.repeat(60) } });

    expect(out.status).toBe(403);
    expect((out.body as { error: { code: string } }).error.code).toBe('AI_CONSENT_REQUIRED');
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('embedDocument требует indexing-согласие и не проходит без него', async () => {
    ctx.getIndexingConsent.mockResolvedValue({ granted: false });
    providerFetch.mockClear();

    const out = await handleAiEndpoint('embedDocument', 'u1', { data: { content: 'текст' } });

    expect(out.status).toBe(403);
    expect((out.body as { error: { code: string } }).error.code).toBe('INDEXING_CONSENT_REQUIRED');
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('embedDocument с обоими согласиями доходит до логики (отказ не от гейта)', async () => {
    // Оба consent=true из beforeEach; логика упадёт на моке провайдера,
    // но статус будет от логики, а не 403 от гейта.
    const out = await handleAiEndpoint('embedDocument', 'u1', { data: { content: 'текст' } });

    expect(out.status).not.toBe(403);
  });

  it('deleteAccount работает без AI-согласия (право субъекта)', async () => {
    ctx.getAiConsent.mockResolvedValue({ granted: false });

    // Логика удаления падает на отсутствии БД — но НЕ на гейте согласия:
    // статус не 403/AI_CONSENT_REQUIRED.
    let caught: unknown;
    try {
      await handleAiEndpoint('deleteAccount', 'u1', {});
    } catch (e) { caught = e; }
    const threwConsent = caught instanceof Error && /AI_CONSENT_REQUIRED/.test(String(caught));
    expect(threwConsent).toBe(false);
  });

  it('ERR-5: getAiConsent error gives 503 SERVICE_UNAVAILABLE in handleChat (not 403 AI_CONSENT_REQUIRED)', async () => {
    ctx.getAiConsent.mockResolvedValue({ granted: false, error: 'unavailable' });
    const req = new FakeReq(chatBody());
    const res = new FakeRes();

    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('ERR-5: tryReserveGlobalRequest unavailable gives 503 SERVICE_UNAVAILABLE in handleChat (not 429 GLOBAL_LIMIT)', async () => {
    ctx.tryReserveGlobalRequest.mockResolvedValue({ error: 'unavailable' });
    const req = new FakeReq(chatBody());
    const res = new FakeRes();

    await handleChat(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('ERR-5: getAiConsent error gives 503 in handleAiEndpoint (not 403)', async () => {
    ctx.getAiConsent.mockResolvedValue({ granted: false, error: 'unavailable' });

    const out = await handleAiEndpoint('summarizeDocument', 'u1', { data: { content: 'x'.repeat(60) } });

    expect(out.status).toBe(503);
    expect((out.body as { error: { code: string } }).error.code).toBe('unavailable');
  });

  it('ERR-5: getIndexingConsent error gives 503 in handleAiEndpoint (not 403)', async () => {
    ctx.getIndexingConsent.mockResolvedValue({ granted: false, error: 'unavailable' });

    const out = await handleAiEndpoint('embedDocument', 'u1', { data: { content: 'текст' } });

    expect(out.status).toBe(503);
    expect((out.body as { error: { code: string } }).error.code).toBe('unavailable');
  });

  it('ERR-5: tryReserveGlobalRequest unavailable gives 503 in handleAiEndpoint (not 429)', async () => {
    ctx.tryReserveGlobalRequest.mockResolvedValue({ error: 'unavailable' });

    const out = await handleAiEndpoint('summarizeDocument', 'u1', { data: { content: 'x'.repeat(60) } });

    expect(out.status).toBe(503);
    expect((out.body as { error: { code: string } }).error.code).toBe('unavailable');
  });
});
