// К25-5 (случай #25): «Память ИИ» сохраняла толкование ассистента от первого
// лица человека. Единица остаётся, только если её слова есть в репликах
// человека; «обязательство» без намерения переносится в инсайты.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }));
vi.mock('../ai/provider', () => ({ generate: (...a: unknown[]) => generateMock(...(a as [])) }));
vi.mock('../../src/shared/ai/aiPolicy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/ai/aiPolicy.js')>();
  return {
    ...actual,
    chargeCall: vi.fn(async () => ({
      settle: vi.fn(), markProduced: vi.fn(), recordUsage: vi.fn(async () => {}), attachGlobalReservation: vi.fn(), refunded: false, settled: null,
    })),
  };
});
process.env.OPENROUTER_API_KEY = 'test-key';

import { extractChatMemoryLogic } from '../ai/extractChatMemory.logic';
import type { AiContext } from '../../src/shared/ai/context.js';

const ctx = {
  checkAndIncrementBulkLimit: vi.fn(async () => ({ ok: true, day: '2026-11-18' })),
  tryReserveGlobalRequest: vi.fn(async () => ({ tokens: 0, refunded: false })),
  recordUsage: vi.fn(async () => {}),
} as unknown as AiContext;

const DATA = {
  messages: [
    { role: 'user' as const, content: 'После сообщений коллеги я долго не могу вернуться к работе. Хочу научиться спокойнее на это реагировать.' },
    { role: 'assistant' as const, content: 'Похоже, время уходит на то, чтобы искать подтверждение снаружи — проверять, одобряют ли тебя.' },
    { role: 'user' as const, content: 'Может быть. Мне от этого грустно.' },
  ],
};

beforeEach(() => { vi.clearAllMocks(); });

describe('К25-5: в память — только сказанное человеком', () => {
  it('толкование ассистента от первого лица отбрасывается, сказанное человеком остаётся', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify([
        { kind: 'commitment', text: 'Я хочу перестать тратить время на поиск внешнего одобрения и подтверждения.' },
        { kind: 'fact', text: 'После сообщений коллеги я долго не могу вернуться к работе.' },
        { kind: 'commitment', text: 'Хочу научиться спокойнее реагировать на сообщения коллеги.' },
      ]),
      tokensIn: 100, tokensOut: 100, model: 'm',
    });
    const r = await extractChatMemoryLogic(ctx, 'u1', DATA) as { memories: { kind: string; text: string }[] };
    const texts = r.memories.map(m => m.text);
    expect(texts.some(t => t.includes('внешнего одобрения')), 'толкование ассистента попало в память').toBe(false);
    expect(texts).toContain('После сообщений коллеги я долго не могу вернуться к работе.');
    expect(texts).toContain('Хочу научиться спокойнее реагировать на сообщения коллеги.');
  });

  it('«обязательство» без намерения — в инсайты', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify([{ kind: 'commitment', text: 'Мне от этого грустно.' }]),
      tokensIn: 10, tokensOut: 10, model: 'm',
    });
    const r = await extractChatMemoryLogic(ctx, 'u1', DATA) as { memories: { kind: string; text: string }[] };
    expect(r.memories).toEqual([{ kind: 'insight', text: 'Мне от этого грустно.' }]);
  });
});
