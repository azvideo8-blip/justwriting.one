import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rerankNotesLogic } from '../ai/rerankNotes.logic';
import { generate } from '../ai/provider';
import { type AiContext, type GlobalReservation } from '../../src/shared/ai/context.js';
import { RERANK_SYSTEM_PROMPT, buildRerankUserMessage } from '../../src/shared/ai/rerankPrompt.js';

vi.mock('../ai/provider', () => ({
  generate: vi.fn(),
}));

function mockAiContext() {
  const globalRes: GlobalReservation = {
    date: '2026-09-08',
    shardId: '0',
    allowance: 2048,
  };

  const refundBulkLimit = vi.fn().mockResolvedValue(undefined);
  const refundGlobalRequest = vi.fn().mockResolvedValue(undefined);
  const recordUsage = vi.fn().mockResolvedValue(undefined);

  const ctx = {
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-09-08' }),
    refundBulkLimit,
    tryReserveGlobalRequest: vi.fn().mockResolvedValue(globalRes),
    refundGlobalRequest,
    recordUsage,
  } as unknown as AiContext;

  return { ctx, refundBulkLimit, refundGlobalRequest, recordUsage, globalRes };
}

describe('L-5: rerankNotesLogic malformed response handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validPayload = {
    query: 'как варить кофе',
    candidates: [
      { documentId: 'doc_1', card: 'Рецепт кофе в турке' },
      { documentId: 'doc_2', card: 'Заметка про чай' },
    ],
    maxResults: 2,
  };

  it('throws AiError and reconciles reservation when model output is invalid JSON (does NOT return 200 empty list)', async () => {
    const { ctx, refundBulkLimit, refundGlobalRequest, recordUsage } = mockAiContext();

    vi.mocked(generate).mockResolvedValueOnce({
      text: 'Вот список релевантных заметок: 1. doc_1, 2. doc_2. Надеюсь помог!',
      tokensIn: 80,
      tokensOut: 25,
      model: 'deepseek/deepseek-v4-flash',
    });

    await expect(
      rerankNotesLogic(ctx, 'user_1', validPayload),
    ).rejects.toThrow('Rerank response was not valid JSON.');

    // Slot is refunded for failed call
    expect(refundBulkLimit).toHaveBeenCalledWith('user_1', '2026-09-08', 'bulk');
    // Because upstream output was produced, idle full refund is NOT called,
    // but usage is reconciled to record actual consumed tokens
    expect(refundGlobalRequest).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledWith(
      'user_1',
      80,
      25,
      expect.objectContaining({ fn: 'chat-stream-abort' }),
      expect.anything(),
    );
  });

  it('returns ordered documentIds and records usage on valid JSON response', async () => {
    const { ctx, refundBulkLimit, recordUsage } = mockAiContext();

    vi.mocked(generate).mockResolvedValueOnce({
      text: '{"ids":["doc_1"]}',
      tokensIn: 80,
      tokensOut: 15,
      model: 'deepseek/deepseek-v4-flash',
    });

    const result = await rerankNotesLogic(ctx, 'user_1', validPayload);

    expect(result).toEqual({ documentIds: ['doc_1'] });
    expect(refundBulkLimit).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledWith(
      'user_1',
      80,
      15,
      { model: 'deepseek/deepseek-v4-flash', fn: 'rerank' },
      expect.anything(),
    );
  });

  it('returns ordered documentIds when model returns 1-based {"idx":[2,1]}', async () => {
    const { ctx, refundBulkLimit, recordUsage } = mockAiContext();

    vi.mocked(generate).mockResolvedValueOnce({
      text: '{"idx":[2,1]}',
      tokensIn: 70,
      tokensOut: 12,
      model: 'deepseek/deepseek-v4-flash',
    });

    const result = await rerankNotesLogic(ctx, 'user_1', validPayload);

    expect(result).toEqual({ documentIds: ['doc_2', 'doc_1'] });
    expect(refundBulkLimit).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalled();
  });

  /**
   * SA-7: прод отправляет общий промпт и общее user-сообщение. Если кто-то
   * вернёт сюда локальную копию — харнес и прод разойдутся молча, и бенчмарк
   * снова будет мерить не то, что происходит в приложении.
   */
  it('отправляет продовый промпт и форму сообщения из общего модуля', async () => {
    const { ctx } = mockAiContext();

    vi.mocked(generate).mockResolvedValueOnce({
      text: '{"idx":[1]}',
      tokensIn: 40,
      tokensOut: 8,
      model: 'deepseek/deepseek-v4-flash',
    });

    await rerankNotesLogic(ctx, 'user_1', validPayload);

    const params = vi.mocked(generate).mock.calls[0]?.[0];
    expect(params?.system).toBe(RERANK_SYSTEM_PROMPT);
    const cardsText = validPayload.candidates
      .map((c, i) => `[${i + 1}]\n${c.card}`)
      .join('\n\n');
    expect(params?.messages[0]?.content).toBe(
      buildRerankUserMessage(validPayload.query, cardsText, validPayload.maxResults),
    );
  });
});
