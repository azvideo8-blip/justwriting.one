import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embedDocumentLogic } from '../ai/embedDocument.logic';
import { embed } from '../ai/provider';
import { type AiContext, type GlobalReservation } from '../../src/shared/ai/context.js';
import { estimateInputTokens } from '../../src/shared/ai/aiPolicy.js';

vi.mock('../ai/provider', () => ({
  embed: vi.fn(),
}));

function mockAiContext() {
  const globalRes: GlobalReservation = {
    date: '2026-09-24',
    shardId: '0',
    allowance: 2048,
  };

  const tryReserveGlobalRequest = vi.fn().mockResolvedValue(globalRes);
  const refundBulkLimit = vi.fn().mockResolvedValue(undefined);
  const refundGlobalRequest = vi.fn().mockResolvedValue(undefined);
  const recordUsage = vi.fn().mockResolvedValue(undefined);

  const ctx = {
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-09-24' }),
    refundBulkLimit,
    tryReserveGlobalRequest,
    refundGlobalRequest,
    recordUsage,
  } as unknown as AiContext;

  return { ctx, tryReserveGlobalRequest };
}

describe('DA-5: Global budget reservation accounts for input tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(embed).mockImplementation(async (chunks: string[]) => ({
      vectors: chunks.map(() => [0.1, 0.2, 0.3]),
      tokens: chunks.length * 10,
      model: 'test-embed',
      dim: 3,
    }));
  });

  it('embedDocumentLogic scales global reservation with input length', async () => {
    const { ctx, tryReserveGlobalRequest } = mockAiContext();

    const shortContent = 'Короткая заметка для эмбеддинга';
    await embedDocumentLogic(ctx, 'user_1', { content: shortContent });

    const shortEstimate = estimateInputTokens([shortContent]);
    expect(tryReserveGlobalRequest).toHaveBeenLastCalledWith(512 + shortEstimate);

    const longContent = 'Длинный текст заметки. '.repeat(1000);
    await embedDocumentLogic(ctx, 'user_1', { content: longContent });

    const longEstimate = estimateInputTokens([longContent]);
    expect(tryReserveGlobalRequest).toHaveBeenLastCalledWith(512 + longEstimate);
    expect(longEstimate).toBeGreaterThan(5000);
  });
});
