// R7F-014: ответ пунктуации, начавшийся с «Ход мысли:», обнулялся санитайзером,
// а запрос был списан. Человек диктует «ход мысли, сначала я подумал…», модель
// оформляет это как «Ход мысли: …» без «ОТВЕТ:» — правило 3 sanitizeAiResponse
// заменяет весь ответ на пустую строку. Клиент получает пустоту, вставляет сырой
// текст с тостом «слова изменены», квота израсходована.
//
// Для ответа ассистента правило обязано остаться: там «ХОД МЫСЛИ:» — артефакт
// рассуждений, и он в заметку человека попасть не должен.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }));

vi.mock('../ai/provider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../ai/provider')>();
  return { ...orig, generate: (...a: unknown[]) => generateMock(...(a as [])) };
});

import { editWithAILogic } from '../ai/editWithAI.logic';
import type { AiContext } from '../../src/shared/ai/context.js';

function makeCtx(): AiContext {
  return {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-16' }),
    checkDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-16' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-10-16' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-10-16', shardId: '0', allowance: 8192 }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn().mockResolvedValue(20),
    isAdmin: vi.fn().mockResolvedValue(false),
  } as unknown as AiContext;
}

const DICTATION = 'сегодня мы ходили в парк и ели мороженое';
const THOUGHT_REPLY = 'Ход мысли: сначала я подумал, что это диктовка без знаков. Итог: Сегодня мы ходили в парк и ели мороженое.';

beforeEach(() => {
  generateMock.mockReset();
});

describe('R7F-014: «Ход мысли:» в ответе пунктуации не обнуляет результат', () => {
  it('пунктуация: ответ с префиксом «Ход мысли:» возвращается целиком', async () => {
    generateMock.mockResolvedValue({ text: THOUGHT_REPLY, usage: { promptTokens: 20, completionTokens: 30 } });

    const out = await editWithAILogic(makeCtx(), 'u_r7f014', { content: DICTATION, action: 'punctuate' }) as { result: string };
    expect(out.result, 'текст человека не имеет права превращаться в пустую строку').toBe(THOUGHT_REPLY);
    expect(out.result.length).toBeGreaterThan(0);
  });

  it('пунктуация: обычный ответ модели проходит как раньше', async () => {
    generateMock.mockResolvedValue({ text: 'Сегодня мы ходили в парк и ели мороженое.', usage: { promptTokens: 20, completionTokens: 12 } });
    const out = await editWithAILogic(makeCtx(), 'u_r7f014', { content: DICTATION, action: 'punctuate' }) as { result: string };
    expect(out.result).toBe('Сегодня мы ходили в парк и ели мороженое.');
  });

  it('другое действие: «ХОД МЫСЛИ:» без «ОТВЕТ:» по-прежнему вырезается целиком', async () => {
    generateMock.mockResolvedValue({ text: THOUGHT_REPLY, usage: { promptTokens: 20, completionTokens: 30 } });
    const out = await editWithAILogic(makeCtx(), 'u_r7f014', { content: DICTATION, action: 'summarize' }) as { result: string };
    expect(out.result).toBe('');
  });

  it('другое действие: «ХОД МЫСЛИ: … ОТВЕТ: …» оставляет только ответ', async () => {
    generateMock.mockResolvedValue({
      text: 'ХОД МЫСЛИ: рассуждение модели.\n\nОТВЕТ: Тихий день у реки.',
      usage: { promptTokens: 20, completionTokens: 10 },
    });
    const out = await editWithAILogic(makeCtx(), 'u_r7f014', { content: DICTATION, action: 'summarize' }) as { result: string };
    expect(out.result).toBe('Тихий день у реки.');
  });

  it('пунктуация: HTML из ответа модели всё равно вырезается', async () => {
    generateMock.mockResolvedValue({
      text: 'Ход мысли: <script>alert(1)</script>Сегодня мы ходили в парк.',
      usage: { promptTokens: 20, completionTokens: 10 },
    });
    const out = await editWithAILogic(makeCtx(), 'u_r7f014', { content: DICTATION, action: 'punctuate' }) as { result: string };
    expect(out.result).not.toContain('<script>');
    expect(out.result).toContain('Сегодня мы ходили в парк.');
  });
});
