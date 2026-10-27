// PR-4 (16.4): «за две недели», «за 2 недели», «за неделю», «за последние 14
// дней» → none: человек просил окно, поиск молчал. Заодно проба «вчера»,
// «позавчера», «на этой неделе», «за неделю» без глагола «писал/было»
// возвращала none — окно считается от сегодняшних местных суток.
//
// Мутация: убрать разбор относительного окна → красные (1)–(7), (9)–(12).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseTemporalQuery } from '../temporalQueryParser';

function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}
afterEach(() => vi.useRealTimers());

describe('PR-4: относительное окно от сегодняшних суток', () => {
  it('«за две недели» и «за 2 недели» — 14 дней', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что было за две недели')).toMatchObject({
      type: 'dateRange', from: '2026-10-11', to: '2026-10-25',
    });
    expect(parseTemporalQuery('что было за 2 недели')).toMatchObject({
      type: 'dateRange', from: '2026-10-11', to: '2026-10-25',
    });
  });

  it('«за неделю» и «за последнюю неделю» — 7 дней', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что было за неделю')).toMatchObject({
      type: 'dateRange', from: '2026-10-18', to: '2026-10-25',
    });
    expect(parseTemporalQuery('что было за последнюю неделю')).toMatchObject({
      type: 'dateRange', from: '2026-10-18', to: '2026-10-25',
    });
  });

  it('«за последние 14 дней» и «за 3 дня»', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('что было за последние 14 дней')).toMatchObject({
      type: 'dateRange', from: '2026-10-11', to: '2026-10-25',
    });
    expect(parseTemporalQuery('что было за 3 дня')).toMatchObject({
      type: 'dateRange', from: '2026-10-22', to: '2026-10-25',
    });
  });

  it('«две недели назад» — точка, окном не становится', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('две недели назад')).toMatchObject({ type: 'none' });
  });

  it('одиночные бытовые слова считаются окном', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('вчера')).toMatchObject({ type: 'dateRange', from: '2026-10-24', to: '2026-10-24' });
    expect(parseTemporalQuery('позавчера')).toMatchObject({ type: 'dateRange', from: '2026-10-23', to: '2026-10-23' });
    expect(parseTemporalQuery('на этой неделе')).toMatchObject({ type: 'dateRange', from: '2026-10-19', to: '2026-10-25' });
    expect(parseTemporalQuery('за неделю')).toMatchObject({ type: 'dateRange', from: '2026-10-18', to: '2026-10-25' });
  });

  it('рассказ о вчерашнем событии окном не режется', () => {
    at('2026-10-25T12:00:00');
    expect(parseTemporalQuery('вчера я поругался с мамой, что делать').type).toBe('none');
  });
});
