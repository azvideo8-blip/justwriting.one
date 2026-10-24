// DE-3 (дейлик 2026-10-22, Н-3): DG-1 размечал только первый маркер хода и
// узнавал только первую шапку. Ход с несколькими заметками и «не влезший» ход
// (маркеры без шапок) оставались без даты и без пометки. Фикстуры синтетические.
// Мутация: одна замена вместо глобальной в prepareApiMessages → первый тест красный.
import { describe, expect, it } from 'vitest';
import { prepareApiMessages } from '../aiChatTransport';
import type { AIMessage } from '../../services/AIService';
import { attachedTurn } from '../../../../test/attachedTurnFixtures';

const NO_TEXT = 'текста этой заметки в этом ходе нет';
const user = (content: string): AIMessage => ({ role: 'user', type: 'chat', content }) as AIMessage;
const answer = (text: string): AIMessage => ({ role: 'assistant', type: 'chat', content: text }) as AIMessage;
const dayMs = (day: string) => new Date(`${day}T12:00:00`).getTime();
const note = (id: string, day: string, title: string) => ({ documentId: id, title, lastSessionAt: dayMs(day), content: `ТЕЛО_${id}` });
const later = user(attachedTurn([note('local_c', '2026-10-22', 'Сегодня')], 'свяжи'));

describe('DE-3: DG-1 для хода с несколькими заметками и для длинной заметки', () => {
  it('прошлый ход с двумя заметками: у каждой своя дата и пометка', () => {
    const out = prepareApiMessages([
      user(attachedTurn([note('local_a', '2026-10-18', 'Ящик'), note('local_b', '2026-10-19', 'Сон')], 'сравни')),
      answer('ответ'),
      later,
    ]);
    expect(out[0]!.content).toBe(
      `[Прикреплена заметка: "Ящик" · 2026-10-18 · ${NO_TEXT}]\n[Прикреплена заметка: "Сон" · 2026-10-19 · ${NO_TEXT}]\n\nсравни`,
    );
  });

  it('прошлый «не влезший» ход: шапки без тел — обе заметки с датой', () => {
    const out = prepareApiMessages([
      user(attachedTurn([
        { documentId: 'local_a', title: 'Ящик', lastSessionAt: dayMs('2026-10-18') },
        { documentId: 'local_b', title: 'Сон', lastSessionAt: dayMs('2026-10-19') },
      ], 'сравни')),
      answer('ответ'),
      later,
    ]);
    expect(out[0]!.content).toBe(
      `[Прикреплена заметка: "Ящик" · 2026-10-18 · ${NO_TEXT}]\n[Прикреплена заметка: "Сон" · 2026-10-19 · ${NO_TEXT}]\n\nсравни`,
    );
  });

  it('старый ход без шапок: обе помечены, дата не выдумывается', () => {
    // форма руками намеренно: легаси-ход без шапок и без тел — предмет разбора
    const out = prepareApiMessages([
      user('[Прикреплена заметка: "Ящик"]\n[Прикреплена заметка: "Сон"]\n\n— — —\nВопрос: сравни'),
      answer('ответ'),
      later,
    ]);
    expect(out[0]!.content).toBe(
      `[Прикреплена заметка: "Ящик" · ${NO_TEXT}]\n[Прикреплена заметка: "Сон" · ${NO_TEXT}]\n\nсравни`,
    );
  });

  it('текущий ход с двумя заметками — ни одна не помечена', () => {
    const out = prepareApiMessages([
      user(attachedTurn([note('local_a', '2026-10-18', 'Ящик'), note('local_b', '2026-10-19', 'Сон')], 'сравни')),
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
      user(attachedTurn([note('local_b', '2026-10-19', 'Сон')], 'разбери')),
      answer('ответ'),
      user(attachedTurn([note('local_a', '2026-10-18', 'Ящик'), note('local_b', '2026-10-19', 'Сон')], 'сравни')),
    ]);
    expect(out[0]!.content).toBe('[Прикреплена заметка: "Сон"]\n\nразбери');
  });
});
