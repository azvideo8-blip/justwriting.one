// AUD-21: /api/csp-report принимал всё от всех без лимита. 32 KB ограничивали
// размер, но не частоту — журнал можно было залить. Пер-IP лимит закрывает это.
// Фальсификация: убрать вызов rateLimited — 11-й запрос перестаёт получать 429.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (req: unknown, res: unknown) => void;

let handler: Handler;

const resFactory = () => {
  const res: Record<string, unknown> = { statusCode: 0 };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = () => res;
  res.end = () => res;
  return res;
};

function post(ip: string) {
  const res = resFactory();
  handler(
    { method: 'POST', headers: { 'x-forwarded-for': ip }, body: { 'csp-report': { id: 'x' } }, socket: {} },
    res,
  );
  return res;
}

describe('AUD-21 csp-report per-IP limit', () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ default: handler } = (await import('../csp-report')) as { default: Handler });
  });

  it('allows up to ten requests per minute from one IP', () => {
    const responses = Array.from({ length: 10 }, () => post('1.2.3.4'));
    for (const r of responses) {
      expect((r as { statusCode: number }).statusCode).toBe(204);
    }
  });

  it('returns 429 past the limit for the same IP, others unaffected', () => {
    for (let i = 0; i < 10; i += 1) post('5.6.7.8');
    const eleventh = post('5.6.7.8');
    expect(eleventh.statusCode).toBe(429);
    const otherIp = post('9.9.9.9');
    expect(otherIp.statusCode).toBe(204);
  });
});

// AUD-21 (доводка): лимит должен стоять на маршруте, которым ходит прод.
// На VPS `/api/csp-report` обслуживает инлайновый блок в api/server.ts, а не
// этот вершеловский обработчик — фикс, положенный только сюда, приёмник не
// защищал. Фальсификация: убрать вызов rateLimited из api/server.ts — тест
// краснеет.
describe('AUD-21 the VPS route shares the limiter', () => {
  it('rate-limits the route api/server.ts actually serves', async () => {
    vi.resetModules();
    const { rateLimited, __resetCspLimiterForTests } = await import('../cspLimiter');
    __resetCspLimiterForTests();

    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const serverSource = readFileSync(resolve(process.cwd(), 'api/server.ts'), 'utf-8');
    // Боевой маршрут обязан звать общий лимитер, а не иметь свою копию.
    expect(serverSource).toContain("from './cspLimiter'");
    expect(serverSource).toMatch(/csp-report[\s\S]{0,400}rateLimited\(clientIp/);

    for (let i = 0; i < 10; i += 1) expect(rateLimited('7.7.7.7')).toBe(false);
    expect(rateLimited('7.7.7.7')).toBe(true);
    expect(rateLimited('8.8.8.8')).toBe(false);
  });

  it('logs the URI shape, not the query string', async () => {
    const { originOnly } = await import('../cspLimiter');
    expect(originOnly('https://justwriting.one/archive?note=secret-title'))
      .toBe('https://justwriting.one/archive');
    expect(originOnly(undefined)).toBeUndefined();
    expect(originOnly('')).toBeUndefined();
  });

  it('keeps CSP keywords, which are the point of the report', async () => {
    // blocked-uri чаще всего не URL, а слово: выбросив его, отчёт перестаёт
    // говорить, ЧТО заблокировано. Фальсификация: вернуть undefined в catch.
    const { originOnly } = await import('../cspLimiter');
    for (const kw of ['inline', 'eval', 'data', 'blob']) {
      expect(originOnly(kw)).toBe(kw);
    }
    expect(originOnly('x'.repeat(500))).toHaveLength(100);
  });
});
