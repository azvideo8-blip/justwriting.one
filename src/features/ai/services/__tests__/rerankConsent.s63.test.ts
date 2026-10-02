import { describe, it, expect, vi, beforeEach } from 'vitest';

// S-56 survivor (S-63): отказ реранжирования по согласию — состояние, не сбой:
// reportError не зовётся (AIService.ts:233).
const mockCallAi = vi.fn();
const reportError = vi.fn();
vi.mock('../../../../core/ai/callAi', () => ({ callAi: (...a: unknown[]) => mockCallAi(...a) }));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }), getIdToken: async () => 't' }));
vi.mock('../../../../shared/utils/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError }));

const { AIService } = await import('../AIService');

const params = { query: 'q', candidates: [{ documentId: 'a', card: 'A' }], maxResults: 8 };

describe('S-56: AIService.rerank under a consent refusal', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['AI_CONSENT_REQUIRED', 'INDEXING_CONSENT_REQUIRED'])('%s → { ok: false } without reportError', async (code) => {
    mockCallAi.mockRejectedValueOnce(Object.assign(new Error(code), { code, status: 403 }));
    const res = await AIService.rerank(params);
    expect(res).toEqual({ ok: false, error: code });
    expect(reportError).not.toHaveBeenCalled();
  });

  it('a real failure is still reported', async () => {
    mockCallAi.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    const res = await AIService.rerank(params);
    expect(res.ok).toBe(false);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
