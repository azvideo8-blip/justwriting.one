// Ревью 0.10.12 (M-1): разбор PR-4 «за N дней/недель» брал начало слова —
// «за деньги» становился окном в двое суток, а «за неделю до переезда» —
// последней неделей. Поиск сужался до вчера, и модели уходило «за этот
// период записей мало». До PR-4 такие вопросы искали по всему архиву.
//
// Мутация: снять конец слова и исключение «до» в parseRelativeSpan → (1), (2) красные.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseTemporalQuery } from '../temporalQueryParser';

afterEach(() => vi.useRealTimers());

describe('ревью 0.10.12: «за …» без окна там, где это не срок', () => {
  it('(1) «за деньги» — не окно', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00'));
    expect(parseTemporalQuery('почему я всё делаю за деньги').type).toBe('none');
  });

  it('(2) «за день/неделю до …» — точка в прошлом, а не последние дни', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00'));
    expect(parseTemporalQuery('что я чувствовал за неделю до переезда').type).not.toBe('dateRange');
    expect(parseTemporalQuery('за день до операции я очень боялся, что это было?').type).not.toBe('dateRange');
  });

  it('контроль: «что было за неделю» по-прежнему окно', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00'));
    expect(parseTemporalQuery('что было за неделю')).toMatchObject({ type: 'dateRange', from: '2026-10-18', to: '2026-10-25' });
    expect(parseTemporalQuery('что было за 3 дня').type).toBe('dateRange');
  });
});
