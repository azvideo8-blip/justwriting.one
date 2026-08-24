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
