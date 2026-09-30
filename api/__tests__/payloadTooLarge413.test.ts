// M-20 (R4-051): 413 у dispatcher.ts и chat.ts должен доходить до клиента по
// настоящему http-соединению. destroy() рвал сокет до ответа — клиент получал
// EPIPE/ECONNRESET вместо статуса.
import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { handle as dispatch } from '../dispatcher';
import { handleChat } from '../chat';
import { MAX_REQUEST_BODY_BYTES } from '../ai/pure';

vi.mock('../auth', () => ({
  requireSession: vi.fn(async () => ({ uid: 'u_413' })),
  passwordRecentlyVerified: vi.fn(() => true),
}));

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    getAiConsent: vi.fn().mockResolvedValue({ granted: true }),
  },
}));

async function postOversized(path: string): Promise<Response> {
  const server = http.createServer((req, res) => {
    void (req.url === '/api/chat' ? handleChat(req, res) : dispatch(req, res));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 33 * 1024),
      headers: { 'Content-Type': 'application/json' },
    });
    await res.arrayBuffer();
    return res;
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  }
}

describe('M-20: 413 over a real http.Server', () => {
  it.each(['/api/chatWithAI', '/api/chat'])('%s over the cap answers 413 with Connection: close', async path => {
    const res = await postOversized(path);
    expect(res.status).toBe(413);
    expect(res.headers.get('connection')).toBe('close');
  });
});
