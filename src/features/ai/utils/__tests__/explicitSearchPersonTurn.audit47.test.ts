// Аудит 0.9.34, §4.7: живой прогон показал ходы, где человек прямо просит
// поискать по архиву, а поисковый блок в запрос не попадает. Это воспроизведение
// на тех же формулировках, что давали ответы без опоры: красное на аудируемом SHA.
//
// Мутация, на которой тест краснеет: откатить предикаты явного поиска в
// aiChatTransport.ts (looksLikeNoteSearch) до узкого набора глаголов —
// «поищи/посмотри/посчитай» перестанут считаться просьбой поискать.
import { describe, it, expect } from 'vitest';
import { shouldRunFullSearch, looksLikeNoteSearch } from '../aiChatTransport';
import { turnScope } from '../turnScope';

// Формулировки из живого прогона §4.7 (синтетический корпус, выдуманные имена).
const EXPLICIT = [
  'поищи в заметках, что у меня было с Олей',
  'найди в записях, что я писала про ссору с Олей',
  'посмотри в архиве, что у нас было с Олей',
  'посчитай в заметках, сколько раз я упоминала маму',
  'собери из всех заметок, что я писала про коробку',
];

describe('аудит §4.7: явная просьба поискать по архиву', () => {
  it('каждая такая реплика запускает полный поиск', () => {
    const misses = EXPLICIT.filter(t => shouldRunFullSearch(t, false) !== true);
    console.log('H47_EXPLICIT ' + JSON.stringify({
      всего: EXPLICIT.length,
      промахи: misses,
      предикаты: EXPLICIT.map(t => ({
        text: t.slice(0, 34),
        fullSearch: shouldRunFullSearch(t, false),
        noteSearch: looksLikeNoteSearch(t),
        scope: turnScope(t),
      })),
    }, null, 1));
    expect(misses).toEqual([]);
  });
});
