import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarizeDocumentLogic } from '../ai/summarizeDocument.logic';
import { generate } from '../ai/provider';
import { type AiContext, type GlobalReservation } from '../../src/shared/ai/context.js';

vi.mock('../ai/provider', () => ({
  generate: vi.fn(),
}));

function mockAiContext() {
  const globalRes: GlobalReservation = {
    date: '2026-09-11',
    shardId: '0',
    allowance: 2048,
  };

  const refundBulkLimit = vi.fn().mockResolvedValue(undefined);
  const refundGlobalRequest = vi.fn().mockResolvedValue(undefined);
  const recordUsage = vi.fn().mockResolvedValue(undefined);

  const ctx = {
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-09-11' }),
    refundBulkLimit,
    tryReserveGlobalRequest: vi.fn().mockResolvedValue(globalRes),
    refundGlobalRequest,
    recordUsage,
  } as unknown as AiContext;

  return { ctx, refundBulkLimit, refundGlobalRequest, recordUsage, globalRes };
}

describe('S-11: summarizeDocumentLogic malformed response reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconciles global reservation rather than full refund when model returns non-JSON text', async () => {
    const { ctx, refundBulkLimit, refundGlobalRequest, recordUsage } = mockAiContext();

    vi.mocked(generate).mockResolvedValueOnce({
      text: 'Sorry, I cannot summarize this note properly.',
      tokensIn: 100,
      tokensOut: 30,
      model: 'openai/gpt-4o-mini',
    });

    await expect(
      summarizeDocumentLogic(ctx, 'user_1', {
        content: 'Сегодня был продуктивный день, я много работал над проектом и размышлял о планах на будущее.',
      })
    ).rejects.toThrow('Failed to parse summary.');

    // User slot is refunded on failed call
    expect(refundBulkLimit).toHaveBeenCalledWith('user_1', '2026-09-11');
    // Because markProduced was called before parse failure, global reservation is reconciled, NOT refunded
    expect(refundGlobalRequest).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledWith(
      'user_1',
      100,
      30,
      expect.objectContaining({ fn: 'chat-stream-abort' }),
      expect.anything()
    );
  });
});
