// AG-CJK-1 (#35): вырезание CJK убрано из sanitizeAiResponse. К моменту вызова
// рассуждения уже срезаны выше (<think>, «ХОД МЫСЛИ:», <reasoning>), поэтому
// под нож попадала только цитата человека: authorPhrases, quotableSentence,
// редактура. Залётный знак в ответе виден; пропавшая цитата — нет.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { traceSpy, generateMock } = vi.hoisted(() => ({
  traceSpy: vi.fn(() => ({ generation: vi.fn() })),
  generateMock: vi.fn(),
}));

vi.mock('../ai/pure', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../ai/pure')>();
  return {
    ...orig,
    getLangfuse: vi.fn(() => ({ trace: traceSpy, flushAsync: vi.fn().mockResolvedValue(undefined) })),
    getActiveModel: vi.fn().mockResolvedValue('test-model'),
  };
});

vi.mock('../ai/provider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../ai/provider')>();
  return { ...orig, generate: (...a: unknown[]) => generateMock(...(a as [])) };
});

import { sanitizeAiResponse } from '../ai/pure';
import { summarizeDocumentLogic } from '../ai/summarizeDocument.logic';
import type { AiContext } from '../../src/shared/ai/context.js';

function makeCtx(): AiContext {
  return {
    checkAndIncrementLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-23' }),
    checkDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-23' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-08-23' }),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-08-23', shardId: '0', allowance: 8192 }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    getDailyLimitCount: vi.fn(),
    getUserDailyLimit: vi.fn().mockResolvedValue(20),
    isAdmin: vi.fn().mockResolvedValue(false),
  } as unknown as AiContext;
}

beforeEach(() => {
  traceSpy.mockClear();
  generateMock.mockReset();
});

describe('AG-CJK-1: CJK в ответе человека не вырезается', () => {
  it('цитата「静」в ответе сохраняется', () => {
    // На коде до правки этот тест падает: строка с диапазонами CJK удаляет
    // цитату целиком.
    const answer = 'Он сказал: цитата「静」и это важно.';
    expect(sanitizeAiResponse(answer)).toBe(answer);
  });

  it('quotableSentence с японской фразой доходит до результата разбора', async () => {
    const content = 'Весь день вспоминал фразу из книги: 静かの海 — и успокаивался. ' +
      'Это было почти медитацией, дышалось легко и свободно.';
    generateMock.mockResolvedValue({
      text: JSON.stringify({
        tone: 'спокойный',
        frequentWords: ['фраза'],
        insights: ['успокаивается через цитаты'],
        themes: ['отдых'],
        extractedFacts: [],
        summary: 'День прошёл спокойно.',
        quotableSentence: '静かの海',
      }),
      usage: { promptTokens: 10, completionTokens: 10 },
    });
    const out = (await summarizeDocumentLogic(makeCtx(), 'u1', { content })) as { quotableSentence?: string };
    expect(out.quotableSentence).toBe('静かの海');
  });

  it('ответ с ХОД МЫСЛИ:/ОТВЕТ: по-прежнему отдаёт только раздел ответа', () => {
    // Охраняет соседний блок разметки — единственное, что теперь отделяет
    // рассуждения от ответа после удаления CJK-строки.
    const response = 'ХОД МЫСЛИ:\n模型は日本語で考えた\n\nОТВЕТ:\nОтвет на русском.';
    expect(sanitizeAiResponse(response)).toBe('Ответ на русском.');
  });

  it('ответ без разделов возвращается неизменным', () => {
    const plain = 'Просто текст ответа без всякой разметки.';
    expect(sanitizeAiResponse(plain)).toBe(plain);
  });
});
