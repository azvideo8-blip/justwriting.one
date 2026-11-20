// DI-2: служебный вызов «выпиши вывод» — списание из пула фона, сверка цитаты на сервере.
// Мутации: (1) 'bulk' → 'user' в chargeCall — красный «пул фоновых операций» (checkDailyLimit не вызван);
// (2) убрать сверку цитаты (вернуть сырой quote модели) — красный «фраза не из ответа».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickInsightLogic } from '../ai/pickInsight.logic';
import { generate } from '../ai/provider';
import { type AiContext, type GlobalReservation } from '../../src/shared/ai/context.js';
import { INSIGHT_PICK_SYSTEM_PROMPT } from '../../src/shared/ai/insightPickPrompt.js';

vi.mock('../ai/provider', () => ({ generate: vi.fn() }));

function mockAiContext() {
  const globalRes: GlobalReservation = { date: '2026-11-20', shardId: '0', allowance: 4096 };
  const ctx = {
    checkDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-11-20' }),
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-11-20' }),
    checkAndIncrementDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-11-20' }),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue(globalRes),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  };
  return ctx as typeof ctx & AiContext;
}

const REPLY = 'Это предположение, не вердикт. Своё и приятное у тебя идёт только после дел, а дела не кончаются никогда. Похоже на тебя?';
const QUOTE = 'Своё и приятное у тебя идёт только после дел, а дела не кончаются никогда.';
const payload = { prevUser: 'Опять сначала почта, потом посуда, потом ночь.', reply: REPLY };
const answer = (o: unknown) => ({ text: JSON.stringify(o), tokensIn: 700, tokensOut: 60, model: 'deepseek/deepseek-v4-flash' });

describe('pickInsightLogic', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('списывается из пула фоновых операций, не из квоты чата; расход под своим именем; цитата из ответа', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer({ found: true, quote: QUOTE }));
    const res = await pickInsightLogic(ctx, 'u1', payload);
    expect(res).toEqual({ quote: QUOTE });
    expect(ctx.checkAndIncrementBulkLimit).toHaveBeenCalledTimes(1);
    expect(ctx.checkDailyLimit).not.toHaveBeenCalled();
    expect(ctx.checkAndIncrementDailyLimit).not.toHaveBeenCalled();
    expect(ctx.recordUsage).toHaveBeenCalledWith('u1', 700, 60, expect.objectContaining({ fn: 'pick_insight' }), expect.anything());
    const call = vi.mocked(generate).mock.calls[0]?.[0];
    expect(call?.system).toBe(INSIGHT_PICK_SYSTEM_PROMPT);
    expect(call?.messages[0]?.content).toContain('Собеседник: Это предположение');
  });

  it('модель вернула фразу не из ответа — сервер отдаёт { quote: null }', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer({ found: true, quote: 'Ты боишься, что тебя не поймут и потому молчишь дома.' }));
    expect(await pickInsightLogic(ctx, 'u1', payload)).toEqual({ quote: null });
    // вызов засчитан: модель отработала, слот не возвращается
    expect(ctx.refundBulkLimit).not.toHaveBeenCalled();
  });

  it('found:false и не-JSON — { quote: null }', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer({ found: false, quote: '' }));
    expect(await pickInsightLogic(ctx, 'u1', payload)).toEqual({ quote: null });
    vi.mocked(generate).mockResolvedValueOnce({ text: 'вывода нет', tokensIn: 1, tokensOut: 1, model: 'm' });
    expect(await pickInsightLogic(ctx, 'u1', payload)).toEqual({ quote: null });
  });

  it('сбой провайдера — ошибка, слот возвращён', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockRejectedValueOnce(new Error('upstream down'));
    await expect(pickInsightLogic(ctx, 'u1', payload)).rejects.toThrow('Insight pick failed.');
    expect(ctx.refundBulkLimit).toHaveBeenCalledWith('u1', '2026-11-20', 'bulk');
  });

  it('кривой вход отвергается до модели и до списания', async () => {
    const ctx = mockAiContext();
    await expect(pickInsightLogic(ctx, 'u1', { prevUser: 'x', reply: '' })).rejects.toThrow('Invalid payload.');
    await expect(pickInsightLogic(ctx, 'u1', { prevUser: 'x'.repeat(1_201), reply: 'ok' })).rejects.toThrow('Invalid payload.');
    await expect(pickInsightLogic(ctx, 'u1', { prevUser: 'x', reply: 'y'.repeat(4_001) })).rejects.toThrow('Invalid payload.');
    expect(generate).not.toHaveBeenCalled();
    expect(ctx.checkAndIncrementBulkLimit).not.toHaveBeenCalled();
  });
});
