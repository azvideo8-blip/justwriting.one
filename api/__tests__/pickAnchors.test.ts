// Шаг «найди опоры» (флаг chat_hypotheses): служебный вызов не тратит квоту чата,
// а наружу отдаёт только id выбранных записей (отрывок выбирает клиент).
//
// Мутации, на которых тесты краснеют:
//  - списывать из квоты чата (`chargeCall(..., 'user')`) → красный «пул фоновых операций»;
//  - не возвращать слот при сбое провайдера → красный «сбой провайдера»;
//  - убрать refine «gist или text» → красный «кандидат без сути и текста».
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
    { documentId: 'local_clay', date: '2026-10-30', title: 'Глина', gist: 'Глина лежит, сначала антресоль.', text: 'Глина так и лежит на балконе. Сказала: сначала надо разобрать антресоль.' },
    { documentId: 'local_piano', date: '2026-04-12', title: 'Пианино', gist: 'Сначала гаммы, потом двор.', text: 'Во двор можно было после гамм. Только к тому времени уже темнело.' },
    { documentId: 'local_coffee', date: '2026-05-20', title: 'Утро', gist: 'Кофе после почты и посуды.', text: 'Кофе налила только после почты и посуды. Остыл.' },
  ],
};
const answer = (anchors: unknown) => ({ text: JSON.stringify({ anchors }), tokensIn: 900, tokensOut: 80, model: 'deepseek/deepseek-v4-flash' });

describe('pickAnchorsLogic', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('списывается из пула фоновых операций, а не из квоты чата; расход записан своим именем', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer([1, 2]));
    const res = await pickAnchorsLogic(ctx, 'u1', payload);
    expect(res).toEqual({ anchors: [{ documentId: 'local_clay' }, { documentId: 'local_piano' }] });
    expect(ctx.checkAndIncrementBulkLimit).toHaveBeenCalledTimes(1);
    expect(ctx.checkAndIncrementDailyLimit).not.toHaveBeenCalled();
    expect(ctx.recordUsage).toHaveBeenCalledWith('u1', 900, 80, expect.objectContaining({ fn: 'pick_anchors' }), expect.anything());
    const call = vi.mocked(generate).mock.calls[0]?.[0];
    expect(call?.system).toBe(ANCHOR_PICK_SYSTEM_PROMPT);
    expect(call?.messages[0]?.content).toContain('[2] 2026-04-12 · Пианино');
  });

  it('меньше двух записей разных дней — пустой список', async () => {
    const ctx = mockAiContext();
    vi.mocked(generate).mockResolvedValueOnce(answer([1]));
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
    // Кандидат без сути и без полного текста — отвергается: модели нечего читать.
    const noGistNoText = payload.candidates.map((c, i) => (i === 0 ? { documentId: c.documentId, date: c.date, title: c.title, gist: '' } : c));
    await expect(pickAnchorsLogic(ctx, 'u1', { ...payload, candidates: noGistNoText })).rejects.toThrow('Invalid payload.');
    expect(generate).not.toHaveBeenCalled();
    expect(ctx.checkAndIncrementBulkLimit).not.toHaveBeenCalled();
  });
});