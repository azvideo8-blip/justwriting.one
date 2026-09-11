import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarizeDocumentLogic } from '../ai/summarizeDocument.logic';
import { summarizeFacetLogic } from '../ai/summarizeFacet.logic';
import { extractChatMemoryLogic } from '../ai/extractChatMemory.logic';
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

describe('S-11 / T-1: endpoint malformed response reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconciles global reservation rather than full refund when model returns non-JSON text in summarizeDocument', async () => {
    const { ctx, refundBulkLimit, refundGlobalRequest, recordUsage } = mockAiContext();

    vi.mocked(generate).mockResolvedValueOnce({
      text: 'Sorry, I cannot summarize this note properly. '.repeat(6),
      tokensIn: 100,
      tokensOut: 30,
      model: 'openai/gpt-4o-mini',
    });

    await expect(
      summarizeDocumentLogic(ctx, 'user_1', {
        content: 'Сегодня был продуктивный день, я много работал над проектом и размышлял о планах на будущее.',
      })
    ).rejects.toThrow('Failed to parse summary.');

    // S-11 / T-1: Model produced >= 200 chars, so slot is NOT refunded even though output was malformed
    expect(refundBulkLimit).not.toHaveBeenCalled();
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

  it('summarizeFacetLogic does not refund slot/global and records usage once on malformed answer', async () => {
    const { ctx, refundBulkLimit, refundGlobalRequest, recordUsage } = mockAiContext();

    vi.mocked(generate).mockResolvedValueOnce({
      text: 'This is an unusable English meta response about the notes that fails Cyrillic check and meta regex filters. '.repeat(3),
      tokensIn: 120,
      tokensOut: 45,
      model: 'openai/gpt-4o-mini',
    });

    const res = await summarizeFacetLogic(ctx, 'user_1', {
      notes: [{ title: 'Заметка 1', excerpt: 'Содержимое заметки для проверки темы и фасета.' }],
    });

    expect(res).toEqual({ label: '', summary: '' });
    expect(refundBulkLimit).not.toHaveBeenCalled();
    expect(refundGlobalRequest).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });

  it('extractChatMemoryLogic does not refund slot/global and records usage once on non-JSON answer', async () => {
    const { ctx, refundBulkLimit, refundGlobalRequest, recordUsage } = mockAiContext();

    vi.mocked(generate).mockResolvedValueOnce({
      text: 'Sorry, I cannot extract any memories from this conversation. Here is an explanation of why that is not valid JSON. '.repeat(3),
      tokensIn: 150,
      tokensOut: 50,
      model: 'openai/gpt-4o-mini',
    });

    const res = await extractChatMemoryLogic(ctx, 'user_1', {
      messages: [{ role: 'user', content: 'Привет, я сегодня думал о планах.' }],
    });

    expect(res).toEqual({ memories: [] });
    expect(refundBulkLimit).not.toHaveBeenCalled();
    expect(refundGlobalRequest).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledTimes(1);
  });
});
