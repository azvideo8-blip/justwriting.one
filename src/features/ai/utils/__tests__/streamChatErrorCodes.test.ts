import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Тестируем только ветку ошибок streamChat: до чтения тела дело доходит
// редко, а мокать ReadableStream ради полного прохода незачем.
vi.mock('../../../../core/auth', () => ({
  getCurrentUser: () => ({ uid: 'u1' }),
  getIdToken: async () => 'tok',
}));

import { streamChat } from '../aiChatTransport';

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('streamChat декодирует код ошибки из тела (AUD-3)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('403 с {"error":"AI_CONSENT_REQUIRED"} → ошибка несёт этот код', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(403, { error: 'AI_CONSENT_REQUIRED' })));
    await expect(streamChat({
      personaId: 'cbt', messages: [{ role: 'user', content: 'привет', type: 'chat' }],
      onChunk: () => {},
    })).rejects.toThrow('AI_CONSENT_REQUIRED');
  });

  it('403 с {"error":{"message":"..."}} (объект) → SERVER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(403, { error: { message: 'nope' } })));
    await expect(streamChat({
      personaId: 'cbt', messages: [{ role: 'user', content: 'привет', type: 'chat' }],
      onChunk: () => {},
    })).rejects.toThrow('SERVER_ERROR');
  });

  it('500 без JSON-тела → SERVER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 500 })));
    await expect(streamChat({
      personaId: 'cbt', messages: [{ role: 'user', content: 'привет', type: 'chat' }],
      onChunk: () => {},
    })).rejects.toThrow('SERVER_ERROR');
  });

  it('429 с GLOBAL_LIMIT сохраняет прежнюю семантику E-1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(429, { error: 'GLOBAL_LIMIT' })));
    await expect(streamChat({
      personaId: 'cbt', messages: [{ role: 'user', content: 'привет', type: 'chat' }],
      onChunk: () => {},
    })).rejects.toThrow('GLOBAL_LIMIT');
  });

  it('503 с {"error":{"code":"SERVICE_UNAVAILABLE"}} → SERVICE_UNAVAILABLE (RC-4)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(503, { error: { code: 'SERVICE_UNAVAILABLE' } })));
    await expect(streamChat({
      personaId: 'cbt', messages: [{ role: 'user', content: 'привет', type: 'chat' }],
      onChunk: () => {},
    })).rejects.toThrow('SERVICE_UNAVAILABLE');
  });

  it('503 с HTML-телом (nginx) → UPSTREAM (RC-4)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>503 Service Temporarily Unavailable</html>', {
      status: 503,
      headers: { 'Content-Type': 'text/html' },
    })));
    await expect(streamChat({
      personaId: 'cbt', messages: [{ role: 'user', content: 'привет', type: 'chat' }],
      onChunk: () => {},
    })).rejects.toThrow('UPSTREAM');
  });

  it('503 с другим JSON-кодом → UPSTREAM (RC-4)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(503, { error: { code: 'OTHER_ERROR' } })));
    await expect(streamChat({
      personaId: 'cbt', messages: [{ role: 'user', content: 'привет', type: 'chat' }],
      onChunk: () => {},
    })).rejects.toThrow('UPSTREAM');
  });
});
