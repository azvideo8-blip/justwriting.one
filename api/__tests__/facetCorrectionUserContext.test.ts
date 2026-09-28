import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
}));

vi.mock('../ai/provider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../ai/provider')>();
  return { ...orig, generate: (...a: unknown[]) => generateMock(...(a as [])) };
});

import { summarizeFacetLogic } from '../ai/summarizeFacet.logic';
import type { AiContext } from '../../src/shared/ai/context.js';

function makeCtx(): AiContext {
  return {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-09-24' }),
    checkDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-09-24' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-09-24' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-09-24', shardId: '0', allowance: 8192 }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn().mockResolvedValue(20),
    isAdmin: vi.fn().mockResolvedValue(false),
  } as unknown as AiContext;
}

const ANSWER = '<label>Отношения</label>\n<description>Автор описывает разговор с партнёром и отмечает, что стал спокойнее реагировать на критику. Тема меняется от обиды к принятию.</description>';

const CORRECTION = 'Поправка: это была не ссора, а рабочий разговор о ремонте.';

function firstGenerateCall(): { system: string; messages: { role: string; content: string }[] } {
  const call = generateMock.mock.calls[0];
  if (!call) throw new Error('generate was not called');
  return call[0] as { system: string; messages: { role: string; content: string }[] };
}

beforeEach(() => {
  generateMock.mockReset();
  generateMock.mockResolvedValue({ text: ANSWER, tokensIn: 50, tokensOut: 50, model: 'deepseek-v4-flash' });
});

describe('C-4 / F-036: the judge correction is user context, not a system instruction', () => {
  it('with a correction the system prompt stays the base prompt and the user message carries the marked block', async () => {
    await summarizeFacetLogic(makeCtx(), 'u1', {
      notes: [{ title: 'Разговор', excerpt: 'Обсудили ремонт, обошлось без претензий.' }],
      correction: CORRECTION,
    });

    expect(generateMock).toHaveBeenCalledTimes(1);
    const arg = firstGenerateCall();

    expect(arg.system).not.toContain(CORRECTION);
    expect(arg.system).not.toContain('Дополнительный контекст:');
    expect(arg.messages[0]!.content).toContain(`[CORRECTION_CONTEXT_START]\n${CORRECTION}\n[CORRECTION_CONTEXT_END]`);
  });

  it('the system prompt declares the correction block as data, not instructions', async () => {
    await summarizeFacetLogic(makeCtx(), 'u1', {
      notes: [{ title: 'Разговор', excerpt: 'Обсудили ремонт, обошлось без претензий.' }],
      correction: CORRECTION,
    });

    const arg = firstGenerateCall();
    expect(arg.system).toContain('[CORRECTION_CONTEXT_START]');
    expect(arg.system).toContain('[CORRECTION_CONTEXT_END]');
  });

  it('without a correction no block is added, and the base prompt is unchanged from the correction case', async () => {
    await summarizeFacetLogic(makeCtx(), 'u1', {
      notes: [{ title: 'Разговор', excerpt: 'Обсудили ремонт, обошлось без претензий.' }],
    });

    const withoutCorrection = firstGenerateCall();
    expect(withoutCorrection.messages[0]!.content).not.toContain('[CORRECTION_CONTEXT_START]');

    generateMock.mockClear();
    await summarizeFacetLogic(makeCtx(), 'u1', {
      notes: [{ title: 'Разговор', excerpt: 'Обсудили ремонт, обошлось без претензий.' }],
      correction: CORRECTION,
    });
    const withCorrection = firstGenerateCall();
    expect(withCorrection.system).toBe(withoutCorrection.system);
  });

  it('focus still appends to the system prompt and the correction still lands in the user message', async () => {
    await summarizeFacetLogic(makeCtx(), 'u1', {
      notes: [{ title: 'Разговор', excerpt: 'Обсудили ремонт, обошлось без претензий.' }],
      focus: 'ремонт',
      correction: CORRECTION,
    });

    const arg = firstGenerateCall();
    expect(arg.system).toContain('Опиши ТОЛЬКО то, что относится к теме «ремонт»');
    expect(arg.system).not.toContain(CORRECTION);
    expect(arg.messages[0]!.content).toContain(`[CORRECTION_CONTEXT_START]\n${CORRECTION}\n[CORRECTION_CONTEXT_END]`);
  });
});
