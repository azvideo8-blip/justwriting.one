import { describe, it, expect } from 'vitest';
import { parseTemporalQuery } from '../temporalQueryParser';

describe('temporalQueryParser', () => {
  it('should parse Russian months', () => {
    const currentYear = new Date().getFullYear();
    expect(parseTemporalQuery('что было в апреле')).toEqual({
      type: 'month',
      month: `${currentYear}-04`,
      rawText: 'что было в апреле',
    });
    expect(parseTemporalQuery('дневник за январь 2025')).toEqual({
      type: 'month',
      month: '2025-01',
      rawText: 'дневник за январь 2025',
    });
    expect(parseTemporalQuery('около декабря')).toEqual({
      type: 'month',
      month: `${currentYear}-12`,
      rawText: 'около декабря',
    });
  });

  it('should parse relative dates and ranges', () => {
    const resultWeek = parseTemporalQuery('что на прошлой неделе произошло');
    expect(resultWeek.type).toBe('dateRange');
    expect(resultWeek.from).toBeDefined();
    expect(resultWeek.to).toBeDefined();

    const resultMonth = parseTemporalQuery('в прошлом месяце');
    expect(resultMonth.type).toBe('month');
    expect(resultMonth.month).toBeDefined();

    const resultYear = parseTemporalQuery('что я писал в этом году');
    expect(resultYear.type).toBe('dateRange');
    expect(resultYear.from).toBe(`${new Date().getFullYear()}-01-01`);
  });

  it('should parse catch-up (recent) queries', () => {
    expect(parseTemporalQuery('напомни что было')).toEqual({
      type: 'recent',
      rawText: 'напомни что было',
    });
    expect(parseTemporalQuery('кратко что было в последнее время')).toEqual({
      type: 'recent',
      rawText: 'кратко что было в последнее время',
    });
  });

  it('should parse and lemmatize Russian names', () => {
    expect(parseTemporalQuery('расскажи про Наташу')).toEqual({
      type: 'person',
      personName: 'Наташа',
      rawText: 'расскажи про Наташу',
    });
    expect(parseTemporalQuery('что о Диме я писал')).toEqual({
      type: 'person',
      personName: 'Дима',
      rawText: 'что о Диме я писал',
    });
    expect(parseTemporalQuery('встреча с Сашей')).toEqual({
      type: 'person',
      personName: 'Саша',
      rawText: 'встреча с Сашей',
    });
    expect(parseTemporalQuery('говорили с Сергеем')).toEqual({
      type: 'person',
      personName: 'Сергей',
      rawText: 'говорили с Сергеем',
    });
  });

  it('should return none for non-temporal queries', () => {
    expect(parseTemporalQuery('как дела?')).toEqual({
      type: 'none',
      rawText: 'как дела?',
    });
  });
});
