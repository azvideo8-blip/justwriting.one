// Дейлик 31.10 (Н-3): 503 гейта согласия уходил значением, без строки в
// журнале службы — монитор E-8 не видел ровно тот сбой базы, ради которого он
// есть. Мутация: убрать console.error в consentUnavailable → красный.
import { describe, it, expect, vi } from 'vitest';

const { ctx } = vi.hoisted(() => ({
  ctx: { getAiConsent: vi.fn(), getIndexingConsent: vi.fn() },
}));
vi.mock('../postgresAiContext', () => ({ postgresAiContext: ctx }));

import { handleAiEndpoint } from '../handlers';

describe('Н-3: 503 гейта согласия оставляет метку [api-5xx]', () => {
  it.each([
    ['summarizeDocument', () => ctx.getAiConsent.mockResolvedValue({ granted: false, error: 'unavailable' })],
    ['embedDocument', () => ctx.getIndexingConsent.mockResolvedValue({ granted: false, error: 'unavailable' })],
  ])('%s', async (endpoint, arrange) => {
    arrange();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await handleAiEndpoint(endpoint, 'u_d31', {});
    expect(out.status).toBe(503);
    expect(spy.mock.calls.map(c => String(c[0]))).toEqual([`[api-5xx] 503 unavailable in ${endpoint}`]);
    spy.mockRestore();
  });
});
