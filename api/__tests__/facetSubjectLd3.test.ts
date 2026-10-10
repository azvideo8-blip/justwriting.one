import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
}));

vi.mock('../ai/provider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../ai/provider')>();
  return { ...orig, generate: (...a: unknown[]) => generateMock(...(a as [])) };
});

import { summarizeFacetLogic } from '../ai/summarizeFacet.logic';
import { SYSTEM_TASK_PROMPTS } from '../../src/shared/ai/systemTaskPrompts';
import type { AiContext } from '../../src/shared/ai/context.js';

// LD-3 (часть 2): портрет строится из фасетов и тем профиля, и ни один из
// промптов этого канала не говорил, кто субъект описания. Заметка, где автор
// пересказывает чужой страх, читалась как его собственный: «личная заметка о
// себе» + «какие чувства и внутренние конфликты» без указания лица.
const SUBJECT = 'Субъект описания — сам пользователь';

function makeCtx(): AiContext {
  return {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-09' }),
    checkDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-09' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-09' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-10-09', shardId: '0', allowance: 8192 }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn().mockResolvedValue(20),
    isAdmin: vi.fn().mockResolvedValue(false),
  } as unknown as AiContext;
}

const ANSWER = '<label>Приёмы</label>\n<description>Автор описывает чужие страхи и замечает за собой, что начал торопить.</description>';

beforeEach(() => {
  generateMock.mockReset();
  generateMock.mockResolvedValue({ text: ANSWER, tokensIn: 50, tokensOut: 50, model: 'deepseek-v4-flash' });
});

describe('LD-3: субъект профиля — автор, а не пересказанные им люди', () => {
  it('правило о субъекте стоит в каждой промпт-задаче профиля', () => {
    for (const key of ['profileThemes', 'profileEmotionalPatterns', 'profileStrengths', 'profileGrowth', 'profileCommunication'] as const) {
      expect(SYSTEM_TASK_PROMPTS[key], key).toContain(SUBJECT);
    }
    // Служебные задачи, которые профиль не строят, правило не трогаем.
    expect(SYSTEM_TASK_PROMPTS.dialogueSummary).not.toContain(SUBJECT);
  });

  it('промпт фасета тоже говорит, кто субъект описания', async () => {
    await summarizeFacetLogic(makeCtx(), 'u1', {
      notes: [{ title: 'Приём', excerpt: 'Клиентка боится увольнения; я заметил, что тороплю её.' }],
    });
    const call = generateMock.mock.calls[0];
    const system = (call?.[0] as { system: string }).system;
    expect(system).toContain(SUBJECT);
    // Правило — часть инструкций, а не пользовательский текст.
    expect(system).toContain('ЖЁСТКИЕ ПРАВИЛА');
    expect(system.indexOf(SUBJECT)).toBeLessThan(system.indexOf('[USER_NOTES_START]'));
  });

  // Мутация-страховка: если правило вставить в user-сообщение, фасет всё
  // равно бы его прочитал, а приватность канала сломалась бы.
  it('правило не уезжает в пользовательское сообщение', async () => {
    await summarizeFacetLogic(makeCtx(), 'u1', {
      notes: [{ title: 'Приём', excerpt: 'Клиентка боится увольнения.' }],
    });
    const call = generateMock.mock.calls[0];
    const arg = call?.[0] as { system: string; messages: { role: string; content: string }[] };
    expect(arg.messages[0]!.content).not.toContain(SUBJECT);
  });
});
