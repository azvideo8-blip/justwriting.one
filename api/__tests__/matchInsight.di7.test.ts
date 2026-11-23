// DI-7: служебный вызов «о том же ли» — два параллельных вызова, номер только
// при согласии обоих, списание из пула фона один раз, расход на оба вызова.
// Мутации: (1) брать ответ первого вызова → красный на паре 1/2;
// (2) 'bulk' → 'user' в chargeCall → красный «пул фоновых операций».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchInsightLogic } from '../ai/matchInsight.logic';
import { generate } from '../ai/provider';
import { type AiContext, type GlobalReservation } from '../../src/shared/ai/context.js';
import { INSIGHT_MATCH_SYSTEM_PROMPT, INSIGHT_MATCH_MAX_TOKENS } from '../../src/shared/ai/insightRecall.js';

vi.mock('../ai/provider', () => ({ generate: vi.fn() }));

function mockAiContext() {
  const globalRes: GlobalReservation = { date: '2026-11-21', shardId: '0', allowance: 4096 };
  const ctx = {
    checkDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-11-21' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-11-21' }),
    checkAndIncrementDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-11-21' }),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue(globalRes),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  };
  return ctx as typeof ctx & AiContext;
}

const payload = {
  message: 'опять весь вечер просидела над чертежами, а к глине так и не подошла',
  insights: [
    { text: 'Своё ты ставишь в конец очереди, а очередь не кончается.', context: 'Про почту и посуду перед своим.' },
    { text: 'Отдых для тебя — награда, а не часть работы.', context: 'Про отпуск с ведомостью.' },
  ],
};
const answer = (n: number) => ({ text: JSON.stringify({ match: n }), tokensIn: 700, tokensOut: 20, model: 'deepseek/deepseek-v4-flash' });

describe('matchInsightLogic', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('оба назвали 1 → match 1; два вызова с одним телом, расход на оба, списание из пула фона', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer(1)).mockResolvedValueOnce(answer(1));
    expect(await matchInsightLogic(ctx, 'u1', payload)).toEqual({ match: 1 });
    expect(generate).toHaveBeenCalledTimes(2);
    const [a, b] = vi.mocked(generate).mock.calls.map(c => c[0]);
    expect(a).toEqual(b);
    expect(a?.system).toBe(INSIGHT_MATCH_SYSTEM_PROMPT);
    expect(a?.maxTokens).toBe(INSIGHT_MATCH_MAX_TOKENS);
    expect(a?.abortMs).toBe(20_000);
    expect(a?.messages[0]?.content).toContain(payload.message);
    expect(ctx.checkAndIncrementBulkLimit).toHaveBeenCalledTimes(1);
    expect(ctx.checkDailyLimit).not.toHaveBeenCalled();
    expect(ctx.checkAndIncrementDailyLimit).not.toHaveBeenCalled();
    // Ревью 0.11.24, N-1: один резерв — одна запись расхода с суммой обоих вызовов.
    // Мутация: запись на каждый вызов (как было) — две записи, красный.
    expect(ctx.recordUsage).toHaveBeenCalledTimes(1);
    expect(ctx.recordUsage).toHaveBeenCalledWith('u1', 1400, 40, expect.objectContaining({ fn: 'match_insight' }), expect.anything());
    // Мутация: 'bulk' → 'user' — красный (checkDailyLimit вызван).
  });

  it('1 и 2 → 0 (сомнение — не вспоминать)', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer(1)).mockResolvedValueOnce(answer(2));
    expect(await matchInsightLogic(ctx, 'u1', payload)).toEqual({ match: 0 });
    // Мутация: брать ответ первого вызова — красный.
  });

  it('1 и исключение → 0', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer(1)).mockRejectedValueOnce(new Error('upstream down'));
    expect(await matchInsightLogic(ctx, 'u1', payload)).toEqual({ match: 0 });
    // Одна запись — расход отработавшего вызова; settle('failed') резерв второй
    // раз не сверяет (защёлка callRes). Мутация: ctx.recordUsage мимо callRes — две, красный.
    expect(ctx.recordUsage).toHaveBeenCalledTimes(1);
    expect(ctx.recordUsage).toHaveBeenCalledWith('u1', 700, 20, expect.objectContaining({ fn: 'match_insight' }), expect.anything());
  });

  it('номер вне списка → 0, даже если оба согласны', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer(5)).mockResolvedValueOnce(answer(5));
    expect(await matchInsightLogic(ctx, 'u1', payload)).toEqual({ match: 0 });
  });

  it('кривой вход отвергается до модели и до списания', async () => {
    const ctx = mockAiContext();
    await expect(matchInsightLogic(ctx, 'u1', { message: '', insights: payload.insights })).rejects.toThrow('Invalid payload.');
    await expect(matchInsightLogic(ctx, 'u1', { message: 'x'.repeat(1_201), insights: payload.insights })).rejects.toThrow('Invalid payload.');
    await expect(matchInsightLogic(ctx, 'u1', { message: 'ok', insights: [] })).rejects.toThrow('Invalid payload.');
    await expect(matchInsightLogic(ctx, 'u1', { message: 'ok', insights: Array.from({ length: 13 }, () => payload.insights[0]) })).rejects.toThrow('Invalid payload.');
    await expect(matchInsightLogic(ctx, 'u1', { message: 'ok', insights: [{ text: 'y'.repeat(401), context: 'c' }] })).rejects.toThrow('Invalid payload.');
    expect(generate).not.toHaveBeenCalled();
    expect(ctx.checkAndIncrementBulkLimit).not.toHaveBeenCalled();
  });
});