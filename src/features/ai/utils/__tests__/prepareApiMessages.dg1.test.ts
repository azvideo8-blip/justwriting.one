// DG-1 (живые диалоги 8.2, 8.3, 12.1): маркер прошлой приложенной заметки в
// истории — без текста и без даты; модель брала свои ответы о ней за её текст и
// путала дни. Фикстуры синтетические. Мутация: убрать пометку в
// prepareApiMessages → первый тест красный.
import { describe, expect, it } from 'vitest';
import { prepareApiMessages } from '../aiChatTransport';
import type { AIMessage } from '../../services/AIService';

const SEP = '\n\n— — —\nВопрос: ';
const turn = (id: string, day: string, title: string, q: string): AIMessage =>
  ({ role: 'user', type: 'chat', content: `[#${id} · ${day}]\n[Прикреплена заметка: "${title}"]\nТЕЛО_${id}${SEP}${q}` }) as AIMessage;
const answer = (text: string): AIMessage => ({ role: 'assistant', type: 'chat', content: text }) as AIMessage;

describe('DG-1: прошлая приложенная заметка в истории', () => {
  it('получает дату и пометку, что текста нет; текущая — нет', () => {
    const out = prepareApiMessages([
      turn('local_a', '2026-10-18', 'Ящик', 'разбери'),
      answer('ответ про A'),
      turn('local_b', '2026-10-21', 'Сегодня', 'свяжи с прошлым'),
    ]);
    expect(out[0]!.content).toBe('[Прикреплена заметка: "Ящик" · 2026-10-18 · текста этой заметки в этом ходе нет]\n\nразбери');
    expect(out[2]!.content).toBe('[Прикреплена заметка: "Сегодня"]\n\nсвяжи с прошлым');
    expect(out.map(m => m.content).join('\n')).not.toContain('ТЕЛО_');
  });

  it('продолжение о той же заметке (без новой шапки) — без пометки', () => {
    const out = prepareApiMessages([
      turn('local_a', '2026-10-18', 'Ящик', 'разбери'),
      answer('ответ про A'),
      { role: 'user', type: 'chat', content: 'а подробнее?' } as AIMessage,
    ]);
    expect(out[0]!.content).toBe('[Прикреплена заметка: "Ящик"]\n\nразбери');
  });

  it('скрытая от ИИ заметка — без даты', () => {
    const out = prepareApiMessages([
      turn('local_a', '2026-10-18', 'Ящик', 'разбери'),
      turn('local_b', '2026-10-21', 'Сегодня', 'свяжи'),
    ], { hiddenCitationIds: new Set(['local_a']) });
    expect(out[0]!.content).toBe('[Прикреплена заметка: "Ящик"]\n\nразбери');
  });
});
