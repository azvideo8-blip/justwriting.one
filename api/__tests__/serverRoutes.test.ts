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

  // Медленный по делу: первый импорт server.ts поднимает весь граф маршрутов
  // (~2–2.7 с в покое, вдвое под нагрузкой полного прогона) — 5 с не хватало (N-34).
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
  }, 15_000);

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

  it('ready endpoint returns status and checks on the production route (POST-5)', async () => {
    server = (await import('../server')).default;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as import('node:net').AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { status: string; checks: Array<{ name: string; status: string; url?: string }> };
      expect(data.status).toBe('ready');
      expect(Array.isArray(data.checks)).toBe(true);

      const dbCheck = data.checks.find(c => c.name === 'database');
      expect(dbCheck).toBeDefined();

      const aiCheck = data.checks.find(c => c.name === 'ai_embed_base_url');
      expect(aiCheck).toBeDefined();
      expect(aiCheck?.status).toBe('fallback_default');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  // Медленный по делу: отдельный процесс node + tsx грузит server.ts с нуля (N-34).
  it('NARROW-3: uncaughtException logs and exits with code 1 for systemd restart', async () => {
    const { execFileSync } = await import('node:child_process');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath, pathToFileURL } = await import('node:url');
    const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const serverPath = resolve(apiDir, 'server.ts');
    const serverUrl = pathToFileURL(serverPath).href;

    const script = [
      "process.env.NODE_ENV = 'production';",
      "process.env.PORT = '3098';",
      "process.env.SUPABASE_JWT_ISS = 'https://example.com/auth/v1';",
      `import(${JSON.stringify(serverUrl)}).then(() => {`,
      "  setTimeout(() => { throw new Error('narrow-3-test-error'); }, 10);",
      "});",
    ].join('\n');

    try {
      execFileSync(
        process.execPath,
        ['--import', 'tsx', '-e', script],
        { cwd: apiDir, stdio: 'pipe' }
      );
      expect.fail('process should have exited with code 1');
    } catch (e: any) {
      expect(e.status).toBe(1);
      const stderr = e.stderr?.toString() ?? '';
      expect(stderr).toContain('[server] uncaughtException');
      expect(stderr).toContain('narrow-3-test-error');
    }
  }, 15_000);
});
