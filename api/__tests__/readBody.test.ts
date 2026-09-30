import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac } from 'node:crypto';
import { handle } from '../dispatcher';
import * as handlersModule from '../handlers';

function makeToken(secret: string): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ sub: 'user-123', role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac('sha256', secret)
    .update(`${head}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${head}.${body}.${sig}`;
}

function createMockRequest(url: string, headers: Record<string, string>, chunks: (Buffer | string)[]): IncomingMessage {
  const stream = new Readable({
    read() {
      for (const chunk of chunks) {
        this.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      this.push(null);
    },
  });

  const req = Object.assign(stream, {
    method: 'POST',
    url,
    headers,
  }) as unknown as IncomingMessage;

  return req;
}

describe('JW-SEC-03: readBody payload size limits', () => {
  const secret = 'test-secret-key';
  const originalSecret = process.env.SUPABASE_JWT_SECRET;

  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = secret;
  });

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.SUPABASE_JWT_SECRET = originalSecret;
    } else {
      delete process.env.SUPABASE_JWT_SECRET;
    }
  });

  it('rejects payload larger than 4MB with HTTP 413 without tearing the socket (R4-051)', async () => {
    const token = makeToken(secret);
    const chunk2MB = Buffer.alloc(2 * 1024 * 1024 + 100, 'a');
    const req = createMockRequest('/api/chatWithAI', { authorization: `Bearer ${token}` }, [
      chunk2MB,
      chunk2MB, // Total ~4.0002 MB > 4MB
    ]);

    

    let responseStatus = 0;
    let responseBody = '';

    const res = {
      writeHead: vi.fn((status: number) => {
        responseStatus = status;
      }),
      end: vi.fn((body: string) => {
        responseBody = body;
      }),
    } as unknown as ServerResponse;

    await handle(req, res);

    expect(responseStatus).toBe(413);
    // AUDIT-7.1: единая форма ошибок через sendError
    expect(JSON.parse(responseBody)).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'PAYLOAD_TOO_LARGE' } });
    // R4-051: readBody сам сокет больше не рвёт (stub-стрим с EOF всё равно
    // авто-destroy'ится Node); живость проверяет реальный http.Server в
    // callReservationLatches.test.ts.
  });

  it('returns HTTP 400 when body is malformed JSON and under 4MB', async () => {
    const token = makeToken(secret);
    const req = createMockRequest('/api/chatWithAI', { authorization: `Bearer ${token}` }, ['not-json{{{']);

    let responseStatus = 0;
    let responseBody = '';

    const res = {
      writeHead: vi.fn((status: number) => {
        responseStatus = status;
      }),
      end: vi.fn((body: string) => {
        responseBody = body;
      }),
    } as unknown as ServerResponse;

    await handle(req, res);

    expect(responseStatus).toBe(400);
    expect(JSON.parse(responseBody)).toEqual({ error: { code: 'INVALID_JSON', message: 'INVALID_JSON' } }); // AUDIT-7.1
  });

  it('accepts valid payload under 4MB and forwards to handleAiEndpoint', async () => {
    vi.spyOn(handlersModule, 'handleAiEndpoint').mockResolvedValueOnce({
      status: 200,
      body: { result: 'ok' },
    });

    const token = makeToken(secret);
    const validJson = JSON.stringify({ message: 'hello world' });
    const req = createMockRequest('/api/chatWithAI', { authorization: `Bearer ${token}` }, [validJson]);

    let responseStatus = 0;
    let responseBody = '';

    const res = {
      writeHead: vi.fn((status: number) => {
        responseStatus = status;
      }),
      end: vi.fn((body: string) => {
        responseBody = body;
      }),
    } as unknown as ServerResponse;

    await handle(req, res);

    expect(responseStatus).toBe(200);
    expect(JSON.parse(responseBody)).toEqual({ result: 'ok' });
    expect(handlersModule.handleAiEndpoint).toHaveBeenCalledWith('chatWithAI', 'user-123', { message: 'hello world' });
  });

  describe('SEC-5: /api/csp-report 32KB cap', () => {
    it('accepts csp-report under 32KB and returns 204 with concise summary', async () => {
      const serverModule = await import('../server');
      const server = serverModule.default;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const validReport = JSON.stringify({
        'csp-report': {
          'document-uri': 'https://justwriting.ru/write',
          'violated-directive': 'script-src',
          'blocked-uri': 'https://evil.com/xss.js',
          'extra-large-garbage': 'a'.repeat(1000),
        },
      });

      const req = createMockRequest('/api/csp-report', {}, [validReport]);
      let responseStatus = 0;
      const res = {
        writeHead: vi.fn((status: number) => {
          responseStatus = status;
        }),
        end: vi.fn(),
      } as unknown as ServerResponse;

      server.emit('request', req, res);
      await new Promise(r => setTimeout(r, 50));

      expect(responseStatus).toBe(204);
      expect(warnSpy).toHaveBeenCalledWith(
        '[csp-report]',
        JSON.stringify({
          'document-uri': 'https://justwriting.ru/write',
          'violated-directive': 'script-src',
          'blocked-uri': 'https://evil.com/xss.js',
        })
      );
    });

    it('rejects csp-report larger than 32KB with 413, not a silent 204 (R4-051)', async () => {
      const serverModule = await import('../server');
      const server = serverModule.default;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const largeChunk = 'x'.repeat(35 * 1024); // 35 KB > 32 KB limit
      const req = createMockRequest('/api/csp-report', {}, [largeChunk]);
      

      let responseStatus = 0;
      const res = {
        writeHead: vi.fn((status: number) => {
          responseStatus = status;
        }),
        end: vi.fn(),
      } as unknown as ServerResponse;

      server.emit('request', req, res);
      await new Promise(r => setTimeout(r, 50));

      expect(responseStatus).toBe(413);
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining(largeChunk));
    });
  });
});
