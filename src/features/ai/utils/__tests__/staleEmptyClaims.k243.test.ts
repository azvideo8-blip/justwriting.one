import { describe, expect, it } from 'vitest';
import { withoutStaleEmptyClaims, STALE_EMPTY_CLAIM_NOTE } from '../aiChatTransport';
import type { AIMessage } from '../../services/AIService';

// К24-3 (случай #24): в ходе 3 под ответом стоял список найденного, а модель
// ответила «ничего не нашлось» — началом своего ответа-отказа из хода 2.
// Фикстуры синтетические.
const REFUSAL = 'По этому запросу в записях ничего не нашлось. В материалах только приложенная заметка.';
const NORMAL = 'В записи про реку [#local_a] ты пишешь об усталости к среде.';
const WITH_RESULTS = '\n\nРезультаты поиска по архиву заметок. Найдено заметок: 2.\n\n[#local_a · 2026-11-01]\nЗаметка 1: "Река"\nтекст';
const NO_RESULTS = '\n\nПо запросу в архиве ничего не найдено.';

const history = (assistant: string): AIMessage[] => [
  { role: 'user', content: 'посмотри в той заметке', type: 'chat' },
  { role: 'assistant', content: assistant, type: 'chat' },
  { role: 'user', content: 'поищи похожее', type: 'chat' },
] as AIMessage[];

describe('К24-3: прошлый ответ-отказ не тянется в ход, где выдача есть', () => {
  it('ход с выдачей — отказ заменён служебной пометкой', () => {
    const out = withoutStaleEmptyClaims(history(REFUSAL), WITH_RESULTS);
    expect(out[1]!.content).toBe(STALE_EMPTY_CLAIM_NOTE);
    expect(out.map(m => m.content).join('\n')).not.toContain('ничего не нашлось');
  });

  it('обычный ответ в истории — история цела', () => {
    expect(withoutStaleEmptyClaims(history(NORMAL), WITH_RESULTS)).toEqual(history(NORMAL));
  });

  it('ход без выдачи после отказа — история цела (там отказ правда)', () => {
    expect(withoutStaleEmptyClaims(history(REFUSAL), NO_RESULTS)).toEqual(history(REFUSAL));
    expect(withoutStaleEmptyClaims(history(REFUSAL), undefined)).toEqual(history(REFUSAL));
  });

  it('ответ со ссылкой, где мимоходом «ничего не нашлось», — не отказ', () => {
    const partial = `Про маму ничего не нашлось, но в записи про реку [#local_a] есть похожее.`;
    expect(withoutStaleEmptyClaims(history(partial), WITH_RESULTS)).toEqual(history(partial));
  });
});
