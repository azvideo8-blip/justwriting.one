// R5-058: AiError с кодом, который маппится в 5xx, уходил клиенту без строки
// в журнале службы — journalctl, единственный источник по runbook, 500-х не видел.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../postgresAiContext', () => ({
  postgresAiContext: {
    getAiConsent: vi.fn(async () => ({ granted: true })),
    getIndexingConsent: vi.fn(async () => ({ granted: true })),
  },
}));

vi.mock('../ai/summarizeDocument.logic', async () => {
  const { AiError } = await import('../../src/shared/ai/context.js');
  return {
    summarizeDocumentLogic: vi.fn(async () => { throw new AiError('internal', 'провайдер ответил мусором'); }),
  };
});

import { handleAiEndpoint } from '../handlers';

describe('R5-058: 5xx от AiError пишется в журнал', () => {
  it('internal → 500 и console.error с эндпоинтом и кодом', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await handleAiEndpoint('summarizeDocument', 'u1', { data: { content: 'x'.repeat(60) } });
      expect(out.status).toBe(500);
      expect(err).toHaveBeenCalledWith(expect.stringMatching(/500 internal in summarizeDocument/));
    } finally {
      err.mockRestore();
    }
  });
});
