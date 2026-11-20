// DI-2: клиент служебного вызова «выпиши вывод». «Вывода нет» и «сбой» — разные ответы
// (класс «нет ответа ≠ нет»). Мутация: в catch вернуть { ok: true, quote: null } — красный.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallAi } = vi.hoisted(() => ({ mockCallAi: vi.fn() }));
vi.mock('../../../../core/ai/callAi', () => ({ callAi: mockCallAi }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AIService } from '../AIService';

describe('AIService.pickInsight', () => {
  beforeEach(() => mockCallAi.mockReset());

  it('callAi бросил — ok:false с названным кодом', async () => {
    mockCallAi.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));
    const res = await AIService.pickInsight('вопрос', 'ответ');
    expect(res.ok).toBe(false);
  });

  it('вернул { quote: null } — ok:true, quote:null (вывода нет — не сбой)', async () => {
    mockCallAi.mockResolvedValueOnce({ quote: null });
    expect(await AIService.pickInsight('вопрос', 'ответ')).toEqual({ ok: true, quote: null });
  });

  it('вернул цитату — ok:true с цитатой; тело запроса обрезано по схеме сервера', async () => {
    mockCallAi.mockResolvedValueOnce({ quote: 'Своё и приятное у тебя идёт только после дел.' });
    const res = await AIService.pickInsight('в'.repeat(2_000), 'о'.repeat(5_000));
    expect(res).toEqual({ ok: true, quote: 'Своё и приятное у тебя идёт только после дел.' });
    const sent = mockCallAi.mock.calls[0]![1] as { prevUser: string; reply: string };
    expect(mockCallAi.mock.calls[0]![0]).toBe('pickInsight');
    expect(sent.prevUser).toHaveLength(1_200);
    expect(sent.reply).toHaveLength(4_000);
  });
});
