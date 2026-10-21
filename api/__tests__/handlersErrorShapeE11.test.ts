// E-11: тело ответа провайдера может содержать текст заметки. В журнал
// службы должна уходить только служебная форма ошибки — ни message, ни body.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    getAiConsent: vi.fn(async () => ({ granted: true })),
    getIndexingConsent: vi.fn(async () => ({ granted: true })),
  },
}));

vi.mock('../ai/editWithAI.logic', () => ({
  editWithAILogic: vi.fn(async () => {
    const error = Object.assign(new Error('MARKER_E11_MESSAGE'), {
      name: 'APICallError',
      code: 'bad_request',
      responseBody: { error: { message: 'MARKER_E11_BODY' } },
    });
    throw error;
  }),
}));

import { handleAiEndpoint } from '../handlers';

describe('E-11: сырой объект ошибки не уходит в журнал', () => {
  it('message и responseBody с MARKER в console.error не попадают', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await handleAiEndpoint('editWithAI', 'u1', { data: { content: 'x'.repeat(20) } });
      expect(out.status).toBe(500);

      const logged = log.mock.calls.flat().map(value => String(value)).join(' ');
      expect(logged).not.toContain('MARKER_E11');
      expect(logged).toContain('name=APICallError');
      expect(logged).toContain('code=bad_request');
    } finally {
      log.mockRestore();
    }
  });
});
