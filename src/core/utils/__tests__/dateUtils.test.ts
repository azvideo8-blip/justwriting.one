import { describe, it, expect } from 'vitest';
import { relativeDate } from '../dateUtils';

describe('relativeDate', () => {
  it('should return correct relative date label', () => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    expect(relativeDate(now)).toBe('сегодня');
    expect(relativeDate(now - dayMs)).toBe('вчера');
    expect(relativeDate(now - 3 * dayMs)).toBe('3 дня назад');
    expect(relativeDate(now - 5 * dayMs)).toBe('5 дней назад');
    expect(relativeDate(now - 8 * dayMs)).toBe('на прошлой неделе');
    expect(relativeDate(now - 15 * dayMs)).toBe('2 недели назад');
    
    const aprDate = new Date(new Date().getFullYear(), 3, 15); // April 15th
    // if now is April or different month, check if it works
    const result = relativeDate(aprDate.getTime());
    expect(result).toMatch(/в апреле|сегодня|вчера|\d+ дня назад|\d+ дней назад|на прошлой неделе|\d+ недели назад/);
  });
});
