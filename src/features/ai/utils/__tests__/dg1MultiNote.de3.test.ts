// DE-3 (дейлик 2026-10-22, Н-3): DG-1 размечал только первый маркер хода и
// узнавал только первую шапку. Ход с несколькими заметками и «не влезший» ход
// (маркеры без шапок) оставались без даты и без пометки. Фикстуры синтетические.
// Мутация: одна замена вместо глобальной в prepareApiMessages → первый тест красный.
import { describe, expect, it } from 'vitest';
import { prepareApiMessages } from '../aiChatTransport';
import type { AIMessage } from '../../services/AIService';

const SEP = '\n\n— — —\nВопрос: ';
const NO_TEXT = 'текста этой заметки в этом ходе нет';
const user = (content: string): AIMessage => ({ role: 'user', type: 'chat', content }) as AIMessage;
const answer = (text: string): AIMessage => ({ role: 'assistant', type: 'chat', content: text }) as AIMessage;
const block = (id: string, day: string, title: string) => `[#${id} · ${day}]\n[Прикреплена заметка: "${title}"]\nТЕЛО_${id}`;
const later = user(`${block('local_c', '2026-10-22', 'Сегодня')}${SEP}свяжи`);

describe('DE-3: DG-1 для хода с несколькими заметками и для длинной заметки', () => {
  it('прошлый ход с двумя заметками: у каждой своя дата и пометка', () => {
    const out = prepareApiMessages([
      user(`${block('local_a', '2026-10-18', 'Ящик')}\n\n---\n\n${block('local_b', '2026-10-19', 'Сон')}${SEP}сравни`),
      answer('ответ'),
      later,
    ]);
    expect(out[0]!.content).toBe(
      `[Прикреплена заметка: "Ящик" · 2026-10-18 · ${NO_TEXT}]\n[Прикреплена заметка: "Сон" · 2026-10-19 · ${NO_TEXT}]\n\nсравни`,
    );
  });

  it('прошлый «не влезший» ход: шапки без тел — обе заметки с датой', () => {
    const out = prepareApiMessages([
      user(`[#local_a · 2026-10-18]\n[Прикреплена заметка: "Ящик"]\n[#local_b · 2026-10-19]\n[Прикреплена заметка: "Сон"]${SEP}сравни`),
      answer('ответ'),
      later,
    ]);
    expect(out[0]!.content).toBe(
      `[Прикреплена заметка: "Ящик" · 2026-10-18 · ${NO_TEXT}]\n[Прикреплена заметка: "Сон" · 2026-10-19 · ${NO_TEXT}]\n\nсравни`,
    );
  });

  it('старый ход без шапок: обе помечены, дата не выдумывается', () => {
    const out = prepareApiMessages([
      user(`[Прикреплена заметка: "Ящик"]\n[Прикреплена заметка: "Сон"]${SEP}сравни`),
      answer('ответ'),
      later,
    ]);
    expect(out[0]!.content).toBe(
      `[Прикреплена заметка: "Ящик" · ${NO_TEXT}]\n[Прикреплена заметка: "Сон" · ${NO_TEXT}]\n\nсравни`,
    );
  });

  it('текущий ход с двумя заметками — ни одна не помечена', () => {
    const out = prepareApiMessages([
      user(`${block('local_a', '2026-10-18', 'Ящик')}\n\n---\n\n${block('local_b', '2026-10-19', 'Сон')}${SEP}сравни`),
      answer('ответ'),
      user('а подробнее?'),
    ]);
    expect(out[0]!.content).toBe('[Прикреплена заметка: "Ящик"]\n[Прикреплена заметка: "Сон"]\n\nсравни');
  });

  // A7: вторая заметка текущего хода уже была в прошлом ходе — её текст в этом
  // ходе есть, пометка «текста нет» в прошлом ходе не ставится.
  // Мутация `currentIds` только из первой шапки (`.slice(0, 1)`) → красный.
  it('вторая заметка текущего хода была в прошлом ходе — без пометки «текста нет»', () => {
    const out = prepareApiMessages([
      user(`${block('local_b', '2026-10-19', 'Сон')}${SEP}разбери`),
      answer('ответ'),
      user(`${block('local_a', '2026-10-18', 'Ящик')}\n\n---\n\n${block('local_b', '2026-10-19', 'Сон')}${SEP}сравни`),
    ]);
    expect(out[0]!.content).toBe('[Прикреплена заметка: "Сон"]\n\nразбери');
  });
});
