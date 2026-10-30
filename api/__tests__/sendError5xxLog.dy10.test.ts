// DY10-2: каждый 5xx через sendError оставляет одну метку [api-5xx] — по ней
// считает монитор. 4xx метку не оставляет. Мутация: убрать console.error → красный.
import { describe, it, expect, vi } from 'vitest';
import { sendError } from '../sendError';
import type { ServerResponse } from 'http';

const fakeRes = () => ({ writeHead: vi.fn(), end: vi.fn() }) as unknown as ServerResponse;

describe('DY10-2: метка [api-5xx]', () => {
  it('5xx — одна строка «[api-5xx] <статус> <код>», 4xx — ничего', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendError(fakeRes(), 502, 'UPSTREAM_ERROR', 'AI provider returned an error.');
    sendError(fakeRes(), 401, 'UNAUTHENTICATED');
    expect(spy.mock.calls.map(c => String(c[0]))).toEqual(['[api-5xx] 502 UPSTREAM_ERROR']);
    spy.mockRestore();
  });
});
