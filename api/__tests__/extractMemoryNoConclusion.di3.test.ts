// DI-3: подтверждённый вывод идёт отдельным путём (addConclusion), из обычного извлечения памяти
// прийти не может: серверный список видов не знает `conclusion`.
// Мутация: добавить 'conclusion' в VALID_KINDS серверной логики — красный.
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
  checkAndIncrementBulkLimit: vi.fn(async () => ({ ok: true, day: '2026-11-20' })),
  tryReserveGlobalRequest: vi.fn(async () => ({ tokens: 0, refunded: false })),
  recordUsage: vi.fn(async () => {}),
} as unknown as AiContext;

const DATA = {
  messages: [
    { role: 'user' as const, content: 'Я всё откладываю своё на потом, пока не доделаю остальное по дому.' },
    { role: 'user' as const, content: 'Да, своё и приятное у меня идёт только после дел по дому.' },
  ],
};

beforeEach(() => { vi.clearAllMocks(); });

describe('DI-3: обычное извлечение не создаёт вывод', () => {
  it('модель вернула kind:"conclusion" — список пуст', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify([{ kind: 'conclusion', text: 'Своё и приятное у меня идёт только после дел по дому.' }]),
      tokensIn: 10, tokensOut: 10, model: 'm',
    });
    const r = await extractChatMemoryLogic(ctx, 'u1', DATA) as { memories: { kind: string; text: string }[] };
    expect(r.memories).toEqual([]);
  });

  it('КОНТРОЛЬ: обычный факт из тех же реплик проходит', async () => {
    generateMock.mockResolvedValue({
      text: JSON.stringify([{ kind: 'fact', text: 'Я откладываю своё на потом, пока не доделаю остальное по дому.' }]),
      tokensIn: 10, tokensOut: 10, model: 'm',
    });
    const r = await extractChatMemoryLogic(ctx, 'u1', DATA) as { memories: { kind: string }[] };
    expect(r.memories).toHaveLength(1);
  });
});
