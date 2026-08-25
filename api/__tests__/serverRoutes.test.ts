import { describe, it, expect, beforeEach } from 'vitest';

// AUDIT-7.2 (урок AG-BILL-2 / M6): защита проверяется на том пути, которым
// идёт прод. Лимитер CSP лежит в api/cspLimiter.ts и подключён к вершеловскому
// обработчику; прод ходит инлайновым маршрутом в server.ts. Этот тест поднимает
// НАСТОЯЩИЙ http.Server из server.ts и ходит по нему сокетом — ровно как nginx.
import { __resetCspLimiterForTests } from '../cspLimiter';

const CLIENT_IP = '203.0.113.7'; // TEST-NET-3: зарезервирован для документации

async function postCspReport(port: number): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/api/csp-report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': CLIENT_IP },
    body: JSON.stringify({ 'csp-report': { 'document-uri': 'https://justwriting.one/write' } }),
  });
  await res.arrayBuffer(); // drain
  return res.status;
}

describe('production route smoke (server.ts)', () => {
  let server: import('node:http').Server;
  let port: number;

  beforeEach(() => {
    __resetCspLimiterForTests();
  });

  it('csp-report rate limit is active on the production route (AUDIT-M6 regression)', async () => {
    server = (await import('../server')).default;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as import('node:net').AddressInfo).port;
    try {
      for (let i = 0; i < 15; i++) {
        if ((await postCspReport(port)) === 429) return;
      }
      throw new Error('rate limit not active on production route /api/csp-report');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('health endpoint answers on the production route', async () => {
    server = (await import('../server')).default;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as import('node:net').AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { status?: string }).status).toBe('ok');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
