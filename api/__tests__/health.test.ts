import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

let server: http.Server;
let baseUrl: string;

function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} });
      });
      res.on('error', reject);
    });
  });
}

describe('API health endpoints', () => {
  beforeAll(async () => {
    const mod = await import('../server');
    server = mod.default;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 3000;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => { server?.close(); });

  it('/health returns 200 with status ok', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('/ready reports active checks; unconfigured database means 503 (L-9 / R4-082)', async () => {
    const res = await get('/ready');
    // Без DATABASE_URL прежний код изображал готовность 200 — теперь честно 503.
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(Array.isArray(res.body.checks)).toBe(true);
    const checks = res.body.checks as Array<{ name: string; status: string }>;
    expect(checks.some(c => c.name === 'database')).toBe(true);
    expect(checks.some(c => c.name === 'ai_embed_base_url')).toBe(true);
  });
});
