import { describe, it, expect } from 'vitest';
import { parseTemporalQuery } from '../temporalQueryParser';
import { localDayKey } from '../../../../core/utils/dateUtils';

// X-4: «вчера», «сегодня», «позавчера» и «на этой неделе» обязаны становиться
// окном по датам. До правки они долетали до catch-up-ветки, и вопрос про
// вчерашний день получал ответ по двум неделям последних событий.
function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return localDayKey(d);
}

describe('X-4: окно по дням и неделе', () => {
  it('«что я писал вчера?» — окно из одного вчерашнего дня', () => {
    const q = parseTemporalQuery('что я писал вчера?');
    expect(q.type).toBe('dateRange');
    expect(q.from).toBe(day(1));
    expect(q.to).toBe(day(1));
    expect(q.phrase).toBe('вчера');
  });

  it('«за вчерашний день» и «что было вчера» — то же окно', () => {
    for (const text of ['за вчерашний день что?', 'что было вчера']) {
      const q = parseTemporalQuery(text);
      expect(q.type, text).toBe('dateRange');
      expect(q.from, text).toBe(day(1));
    }
  });

  it('«сегодня» и «позавчера» — свои окна', () => {
    const today = parseTemporalQuery('что я писал сегодня');
    expect(today.type).toBe('dateRange');
    expect(today.from).toBe(day(0));
    expect(today.phrase).toBe('сегодня');

    const before = parseTemporalQuery('позавчера вечером');
    expect(before.type).toBe('dateRange');
    expect(before.from).toBe(day(2));
    expect(before.phrase).toBe('позавчера');
  });

  it('«на этой неделе» — от понедельника до сегодня', () => {
    const q = parseTemporalQuery('что нового на этой неделе?');
    expect(q.type).toBe('dateRange');
    expect(q.phrase).toBe('на этой неделе');
    const from = new Date(q.from!);
    expect(from.getDay()).toBe(1);
    expect(q.to).toBe(day(0));
  });

  it('прежние формы не смещаются', () => {
    expect(parseTemporalQuery('на прошлой неделе').type).toBe('dateRange');
    expect(parseTemporalQuery('что было в марте').type).toBe('month');
    expect(parseTemporalQuery('напомни, что я решал').type).toBe('recent');
    expect(parseTemporalQuery('что у меня нового').type).toBe('recent');
    expect(parseTemporalQuery('привет').type).toBe('none');
  });

  it('окно по слову не отнимает поиск по имени', () => {
    // «про Сашу вчера» — имя и окно важны оба; окно выбирается первым, а имя
    // остаётся в тексте запроса и ищется им.
    const q = parseTemporalQuery('что я писал про Сашу вчера');
    expect(q.type).toBe('dateRange');
    expect(q.phrase).toBe('вчера');
  });
});
