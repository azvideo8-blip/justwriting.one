// PR-1 (16.1): «с 10 октября по 24 октября» возвращал весь месяц, «с 10.10 по
// 24.10» — ничего, одиночное «10 октября» — тоже весь месяц. Человек просил
// период, а модель получала месяц или пустоту.
//
// Мутация: убрать разбор диапазона и одиночной даты (вернуть month-ветку первой)
// → тесты (1)–(4), (6), (7) красные.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseTemporalQuery } from '../temporalQueryParser';

function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}
afterEach(() => vi.useRealTimers());

describe('PR-1: диапазон и одиночная дата', () => {
  it('«с 10 октября по 24 октября» — диапазон, не месяц', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что я писал с 10 октября по 24 октября')).toMatchObject({
      type: 'dateRange', from: '2026-10-10', to: '2026-10-24',
    });
  });

  it('«с 10 по 24 октября» — месяц из второй даты', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что я писал с 10 по 24 октября')).toMatchObject({
      type: 'dateRange', from: '2026-10-10', to: '2026-10-24',
    });
  });

  it('«с 10.10 по 24.10» — числовой диапазон', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что я писал с 10.10 по 24.10')).toMatchObject({
      type: 'dateRange', from: '2026-10-10', to: '2026-10-24',
    });
  });

  it('диапазон через декабрь/январь без года не переворачивается', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что было с 20 декабря по 10 января')).toMatchObject({
      type: 'dateRange', from: '2025-12-20', to: '2026-01-10',
    });
  });

  it('одиночная дата — этот день, а «с даты» — с этого дня по сегодня', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что было 10 октября')).toMatchObject({
      type: 'dateRange', from: '2026-10-10', to: '2026-10-10',
    });
    expect(parseTemporalQuery('что было с 10 октября')).toMatchObject({
      type: 'dateRange', from: '2026-10-10', to: '2026-10-25',
    });
  });

  it('будущая дата дальше 92 дней — прошлый год; близкая — этот', () => {
    at('2026-01-05T12:00:00');
    expect(parseTemporalQuery('что было 10 октября')).toMatchObject({
      type: 'dateRange', from: '2025-10-10', to: '2025-10-10',
    });
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что было 10 ноября')).toMatchObject({
      type: 'dateRange', from: '2026-11-10', to: '2026-11-10',
    });
  });

  it('год при дате учитывается', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что было 10 октября 2024')).toMatchObject({
      type: 'dateRange', from: '2024-10-10', to: '2024-10-10',
    });
    expect(parseTemporalQuery('что было с 10 октября 2024'), '«с даты» — по сегодня').toMatchObject({
      type: 'dateRange', from: '2024-10-10', to: '2026-10-25',
    });
  });

  it('время «с 8.10 по 9.40» не становится диапазоном', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('сидел в очереди с 8.10 по 9.40').type).toBe('none');
  });

  it('«в октябре» и «за октябрь» остаются месяцем', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что было в октябре')).toMatchObject({ type: 'month', month: '2026-10' });
    expect(parseTemporalQuery('что было за октябрь')).toMatchObject({ type: 'month', month: '2026-10' });
  });
});
