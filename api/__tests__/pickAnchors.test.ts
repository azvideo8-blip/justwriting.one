// Шаг «найди опоры» (флаг chat_hypotheses): служебный вызов не тратит квоту чата,
// а наружу отдаёт только отрывки, которые дословно стоят в названной записи.
//
// Мутации, на которых тесты краснеют:
//  - списывать из квоты чата (`chargeCall(..., 'user')`) → красный «пул фоновых операций»;
//  - отдавать ответ модели без сверки → красный «выдуманный отрывок»;
//  - не возвращать слот при сбое провайдера → красный «сбой провайдера».
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pickAnchorsLogic } from '../ai/pickAnchors.logic';
import { generate } from '../ai/provider';
import { type AiContext, type GlobalReservation } from '../../src/shared/ai/context.js';
import { ANCHOR_PICK_SYSTEM_PROMPT } from '../../src/shared/ai/anchorPickPrompt.js';

vi.mock('../ai/provider', () => ({ generate: vi.fn() }));

function mockAiContext() {
  const globalRes: GlobalReservation = { date: '2026-11-17', shardId: '0', allowance: 4096 };
  const ctx = {
    checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-11-17' }),
    checkAndIncrementDailyLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-11-17' }),
    refundBulkLimit: vi.fn().mockResolvedValue(undefined),
    refundDailyLimit: vi.fn().mockResolvedValue(undefined),
    tryReserveGlobalRequest: vi.fn().mockResolvedValue(globalRes),
    refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  };
  return ctx as typeof ctx & AiContext;
}

const payload = {
  message: 'опять не подошла к глине и злюсь на себя',
  candidates: [
    { documentId: 'local_clay', date: '2026-10-30', title: 'Глина', text: 'Глина так и лежит на балконе. Сказала: сначала надо разобрать антресоль.' },
    { documentId: 'local_piano', date: '2026-04-12', title: 'Пианино', text: 'Во двор можно было после гамм. Только к тому времени уже темнело.' },
    { documentId: 'local_coffee', date: '2026-05-20', title: 'Утро', text: 'Кофе налила только после почты и посуды. Остыл.' },
  ],
};
const answer = (anchors: unknown) => ({ text: JSON.stringify({ anchors }), tokensIn: 900, tokensOut: 80, model: 'deepseek/deepseek-v4-flash' });

describe('pickAnchorsLogic', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('списывается из пула фоновых операций, а не из квоты чата; расход записан своим именем', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer([
      { n: 1, quote: 'Сказала: сначала надо разобрать антресоль.' },
      { n: 2, quote: 'Только к тому времени уже темнело.' },
    ]));
    const res = await pickAnchorsLogic(ctx, 'u1', payload);
    expect(res).toEqual({ anchors: [
      { documentId: 'local_clay', quote: 'Сказала: сначала надо разобрать антресоль.' },
      { documentId: 'local_piano', quote: 'Только к тому времени уже темнело.' },
    ] });
    expect(ctx.checkAndIncrementBulkLimit).toHaveBeenCalledTimes(1);
    expect(ctx.checkAndIncrementDailyLimit).not.toHaveBeenCalled();
    expect(ctx.recordUsage).toHaveBeenCalledWith('u1', 900, 80, expect.objectContaining({ fn: 'pick_anchors' }), expect.anything());
    const call = vi.mocked(generate).mock.calls[0]?.[0];
    expect(call?.system).toBe(ANCHOR_PICK_SYSTEM_PROMPT);
    expect(call?.messages[0]?.content).toContain('[2] 2026-04-12 · Пианино');
  });

  it('выдуманный отрывок наружу не уходит; осталась одна опора — пустой список', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer([
      { n: 1, quote: 'Сказала: сначала надо разобрать антресоль.' },
      { n: 2, quote: 'Бабушка запрещала гулять с ребятами.' },
    ]));
    expect(await pickAnchorsLogic(ctx, 'u1', payload)).toEqual({ anchors: [] });
  });

  it('ответ не JSON — пустой список, вызов засчитан (ход пойдёт без гипотезы)', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce({ text: 'Подходят записи 1 и 2.', tokensIn: 900, tokensOut: 20, model: 'm' });
    expect(await pickAnchorsLogic(ctx, 'u1', payload)).toEqual({ anchors: [] });
    expect(ctx.refundBulkLimit).not.toHaveBeenCalled();
  });

  it('сбой провайдера — ошибка, слот возвращён', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockRejectedValueOnce(new Error('upstream down'));
    await expect(pickAnchorsLogic(ctx, 'u1', payload)).rejects.toThrow('Anchor pick failed.');
    expect(ctx.refundBulkLimit).toHaveBeenCalledWith('u1', '2026-11-17', 'bulk');
  });

  it('кривой вход отвергается до модели', async () => {
    const ctx = mockAiContext();
    await expect(pickAnchorsLogic(ctx, 'u1', { message: 'x', candidates: [payload.candidates[0]] })).rejects.toThrow('Invalid payload.');
    await expect(pickAnchorsLogic(ctx, 'u1', { ...payload, candidates: payload.candidates.map(c => ({ ...c, date: '30.10.2026' })) })).rejects.toThrow('Invalid payload.');
    expect(generate).not.toHaveBeenCalled();
    expect(ctx.checkAndIncrementBulkLimit).not.toHaveBeenCalled();
  });
});
