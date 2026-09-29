import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
}));

vi.mock('../ai/provider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../ai/provider')>();
  return { ...orig, generate: (...a: unknown[]) => generateMock(...(a as [])) };
});

import { summarizeBeliefClusterLogic } from '../ai/summarizeBeliefCluster.logic';
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

const HINT = 'Прошлая попытка потеряла условие «иногда».';
const input = (correctionHint?: string) => ({
  evidence: [{ id: 'e1', date: '2026-09-01', snippet: 'Иногда я злюсь на работе, но дома спокоен.' }],
  firstSeenAt: '2026-09-01',
  ...(correctionHint ? { correctionHint } : {}),
});

function firstGenerateCall(): { system: string; messages: { role: string; content: string }[] } {
  const call = generateMock.mock.calls[0];
  if (!call) throw new Error('generate was not called');
  return call[0] as { system: string; messages: { role: string; content: string }[] };
}

// F-036: подсказка к повтору приходит из ответа модели — в system она была бы командой.
describe('summarizeBeliefCluster: correction hint is user-side data', () => {
  beforeEach(() => {
    generateMock.mockReset();
    generateMock.mockResolvedValue({ text: 'Пользователь иногда злится на работе, но дома спокоен.', tokensIn: 50, tokensOut: 20, model: 'm' });
  });

  it('hint goes into the user message between markers, system is unchanged', async () => {
    await summarizeBeliefClusterLogic(makeCtx(), 'u1', input());
    const without = firstGenerateCall();
    generateMock.mockClear();
    await summarizeBeliefClusterLogic(makeCtx(), 'u1', input(HINT));
    const withHint = firstGenerateCall();
    expect(withHint.system).toBe(without.system);
    expect(withHint.system).not.toContain(HINT);
    expect(withHint.system).toContain('[CORRECTION_CONTEXT_START]');
    expect(withHint.messages[0]!.content).toContain('[CORRECTION_CONTEXT_START]');
    expect(withHint.messages[0]!.content).toContain(HINT);
  });
});
