// Дейлик 27.10 Н-3: дословная цитата через границу двух приложенных заметок
// теряла кавычки. Строки шапки следующего блока («[#id · дата]»,
// «[Прикреплена заметка: …]») приклеивались к его первой фразе, и граница фраз
// в материалах стояла не там, где конец заметки. Данные выдуманные.
//
// Мутация: убрать подстановку шапок в phrasesOf → (1) красный;
// остальные кейсы — контроли, зелёные и до правки.
import { describe, expect, it } from 'vitest';
import { unquoteAbsent } from '../../../../shared/ai/quoteGuard';
import { attachedTurn } from '../../utils/attachedNoteFormat';
import { quoteMaterialsForTurn } from '../useAIChat';

const at = new Date('2026-10-20T12:00:00').getTime();
const A = { documentId: 'local_d27_a', title: 'Утро', lastSessionAt: at, content: 'Утром шёл дождь и я решил остаться дома' };
const B = { documentId: 'local_d27_b', title: 'Вечер', lastSessionAt: at, content: 'Вечером уехал в город надолго.' };
const QUOTE = 'Ответ: «Утром шёл дождь и я решил остаться дома.\n\nВечером уехал в город надолго.» конец';

describe('дейлик 27.10 Н-3: цитата через границу заметок', () => {
  it('(1) широкий ход: шапка второго блока не склеивается с его первой фразой', () => {
    const materials = attachedTurn([{ ...A, content: `${A.content}.` }, B], 'разбери');
    expect(unquoteAbsent(QUOTE, materials).stripped).toHaveLength(0);
  });

  it('контроль: строгий ход, конец заметки без точки — цитата в кавычках', () => {
    const materials = quoteMaterialsForTurn('note', [A, B], () => false, []);
    expect(unquoteAbsent(QUOTE, materials).stripped).toHaveLength(0);
  });

  it('контроль (DL-19): склейка хвоста одной заметки с началом другой без границы — не дословная', () => {
    const materials = attachedTurn([{ ...A, content: `${A.content}.` }, B], 'разбери');
    const glued = 'Ответ: «я решил остаться дома и вечером уехал в город надолго» конец';
    expect(unquoteAbsent(glued, materials).stripped).toHaveLength(1);
  });
});
