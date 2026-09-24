import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatWithAILogic } from '../ai/chatWithAI.logic';
import { extractChatMemoryLogic } from '../ai/extractChatMemory.logic';
import { generate } from '../ai/provider';
import type { AiContext } from '../../src/shared/ai/context.js';
import { validateInternalCallRestrictions } from '../../src/shared/ai/aiPolicy.js';

vi.mock('../ai/provider', () => ({
  generate: vi.fn(),
  getActiveModel: vi.fn().mockResolvedValue('test-model'),
}));

function ctxSpy() {
  return {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-22' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-22' }),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ id: 'res_1' }),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    recordDailySpendRub: vi.fn().mockResolvedValue(undefined),
  } as unknown as AiContext;
}

describe('DA-2: Internal AI payload limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generate).mockResolvedValue({ text: '[]', tokensIn: 10, tokensOut: 10, model: 'test-model' });
  });

  describe('validateInternalCallRestrictions', () => {
    it('rejects auto_name with total input > 4000 characters', () => {
      expect(() =>
        validateInternalCallRestrictions({
          callType: 'auto_name',
          personaId: 'coach',
          messages: [{ role: 'user', content: 'x'.repeat(4001) }],
        })
      ).toThrow(/exceeds 4000 characters/);
    });

    it('rejects follow_up with total input > 4000 characters', () => {
      expect(() =>
        validateInternalCallRestrictions({
          callType: 'follow_up',
          personaId: 'coach',
          messages: [{ role: 'user', content: 'x'.repeat(4001) }],
        })
      ).toThrow(/exceeds 4000 characters/);
    });

    it('accepts auto_name with total input <= 4000 characters', () => {
      expect(
        validateInternalCallRestrictions({
          callType: 'auto_name',
          personaId: 'coach',
          messages: [{ role: 'user', content: 'x'.repeat(4000) }],
        })
      ).toEqual({ isInternal: true });
    });
  });

  describe('chatWithAILogic endpoint', () => {
    it('returns 400 (invalid-argument) for auto_name with oversized input', async () => {
      const ctx = ctxSpy();
      await expect(
        chatWithAILogic(ctx, 'user_1', {
          personaId: 'coach',
          callType: 'auto_name',
          messages: [{ role: 'user', content: 'x'.repeat(4500) }],
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    });
  });

  describe('extractChatMemoryLogic endpoint', () => {
    it('returns 400 (invalid-argument) for memory extraction exceeding 4000 total characters', async () => {
      const ctx = ctxSpy();
      await expect(
        extractChatMemoryLogic(ctx, 'user_1', {
          messages: [
            { role: 'user', content: 'x'.repeat(2500) },
            { role: 'assistant', content: 'y'.repeat(2000) },
          ],
        })
      ).rejects.toMatchObject({ code: 'invalid-argument' });
    });
  });
});
