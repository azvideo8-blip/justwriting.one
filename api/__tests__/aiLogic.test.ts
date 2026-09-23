// TEST-1 §2.20: model JSON failing the zod schema is rejected AND refunded
// through the same settled/refund region as a parse failure.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
}));

vi.mock('../ai/provider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../ai/provider')>();
  return { ...orig, generate: (...a: unknown[]) => generateMock(...(a as [])) };
});

import { validateCustomPromptLogic } from '../ai/validateCustomPrompt.logic';
import { summarizeDocumentLogic } from '../ai/summarizeDocument.logic';
import { editWithAILogic } from '../ai/editWithAI.logic';
import { judgeBeliefCandidateLogic } from '../ai/judgeBeliefCandidate.logic';
import type { AiContext } from '../../src/shared/ai/context.js';

function makeCtx(): AiContext {
  return {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-22' }),
    checkDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-22' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-22' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-08-22', shardId: '0', allowance: 8192 }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn().mockResolvedValue(20),
    isAdmin: vi.fn().mockResolvedValue(false),
  } as unknown as AiContext;
}

beforeEach(() => {
  generateMock.mockReset();
});

describe('2.20 model JSON validated by zod, refund on schema failure', () => {
  const content = 'Запись о дне: '.padEnd(60, 'х') + ' было тихо, гулял у реки и думал о работе.';

  it('schema-valid output passes through', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify({
        tone: 'спокойный',
        frequentWords: ['река', 'работа'],
        insights: ['устал от дедлайна'],
        themes: ['отдых'],
        extractedFacts: ['гулял у реки'],
        summary: 'Тихий день у реки.',
      }),
      usage: { promptTokens: 10, completionTokens: 10 },
    });
    const out = await summarizeDocumentLogic(makeCtx(), 'u1', { content });
    expect(out).toMatchObject({
      tone: 'спокойный',
      frequentWords: ['река', 'работа'],
      insights: ['устал от дедлайна'],
      themes: ['отдых'],
      extractedFacts: ['гулял у реки'],
      summary: 'Тихий день у реки.',
    });
  });

  it('frequentWords as a number is rejected and refunded, not a TypeError after charging', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify({
        tone: 'спокойный',
        frequentWords: 42,               // ← the poison
        insights: ['x'],
        themes: ['t'],
        extractedFacts: ['f'],
      }),
      usage: { promptTokens: 10, completionTokens: 10 },
    });
    const ctx = makeCtx();
    await expect(summarizeDocumentLogic(ctx, 'u1', { content }))
      .rejects.toMatchObject({ code: 'unavailable' });
    // S-11: The user's bulk limit is refunded so they are not charged, but tokens were burned,
    // so global reservation is reconciled (recorded in usage) rather than refunded.
    expect(ctx.refundBulkLimit).toHaveBeenCalledWith('u1', '2026-08-22', 'bulk');
    expect(ctx.refundGlobalRequest).not.toHaveBeenCalled();
    expect(ctx.recordUsage).toHaveBeenCalledWith(
      'u1',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ fn: 'chat-stream-abort' }),
      expect.objectContaining({ date: '2026-08-22', shardId: '0' }),
    );
  });

  it('out-of-range valence (1e999 → Infinity) is rejected as unavailable (model output failure)', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify({
        tone: 'x', frequentWords: [], insights: [], themes: [], extractedFacts: [],
        valence: Infinity,
      }),
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    await expect(summarizeDocumentLogic(makeCtx(), 'u1', { content }))
      .rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('DEEP-9: editWithAI and validateCustomPrompt pass chargedDay to refundDailyLimit', () => {
  it('editWithAI refunds with chargedDay on global reservation failure', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.checkAndIncrementLimit).mockResolvedValue({ ok: true, day: '2026-09-06' });
    vi.mocked(ctx.tryReserveGlobalRequest).mockResolvedValue(null);

    await expect(editWithAILogic(ctx, 'user_1', { content: 'My text', action: 'summarize' }))
      .rejects.toMatchObject({ code: 'resource-exhausted' });

    expect(ctx.refundDailyLimit).toHaveBeenCalledWith('user_1', '2026-09-06');
  });

  it('editWithAI refunds with chargedDay on model failure', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.checkAndIncrementLimit).mockResolvedValue({ ok: true, day: '2026-09-06' });
    generateMock.mockRejectedValue(new Error('upstream model error'));

    await expect(editWithAILogic(ctx, 'user_1', { content: 'My text', action: 'summarize' }))
      .rejects.toMatchObject({ code: 'internal' });

    expect(ctx.refundDailyLimit).toHaveBeenCalledWith('user_1', '2026-09-06');
    expect(ctx.refundGlobalRequest).toHaveBeenCalled();
  });

  it('validateCustomPrompt refunds with chargedDay on global reservation failure', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.checkAndIncrementLimit).mockResolvedValue({ ok: true, day: '2026-09-06' });
    vi.mocked(ctx.tryReserveGlobalRequest).mockResolvedValue(null);

    await expect(validateCustomPromptLogic(ctx, 'user_1', { prompt: 'Valid assistant prompt text for testing' }))
      .rejects.toMatchObject({ code: 'resource-exhausted' });

    expect(ctx.refundDailyLimit).toHaveBeenCalledWith('user_1', '2026-09-06');
  });

  it('validateCustomPrompt refunds with chargedDay on model failure', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.checkAndIncrementLimit).mockResolvedValue({ ok: true, day: '2026-09-06' });
    generateMock.mockRejectedValue(new Error('upstream model error'));

    await expect(validateCustomPromptLogic(ctx, 'user_1', { prompt: 'Valid assistant prompt text for testing' }))
      .rejects.toMatchObject({ code: 'internal' });

    expect(ctx.refundDailyLimit).toHaveBeenCalledWith('user_1', '2026-09-06');
    expect(ctx.refundGlobalRequest).toHaveBeenCalled();
  });

  it('ERR-7: judgeBeliefCandidateLogic throws unavailable on model failure/timeout', async () => {
    const ctx = makeCtx();
    generateMock.mockRejectedValue(new Error('upstream model timeout'));

    await expect(judgeBeliefCandidateLogic(ctx, 'user_1', {
      belief: 'Пользователь любит бег',
      evidence: [{ id: 'e1', date: '2026-09-01', snippet: 'Бегал утром' }],
    })).rejects.toMatchObject({ code: 'unavailable' });

    expect(ctx.refundBulkLimit).toHaveBeenCalled();
    expect(ctx.refundGlobalRequest).toHaveBeenCalled();
  });
});

