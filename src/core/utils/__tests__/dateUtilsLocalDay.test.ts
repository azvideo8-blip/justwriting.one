import { describe, it, expect } from 'vitest';
import { parseLocalizedDate } from '../dateUtils';

// DA-21: «2026-09-24» из импортируемого файла — это день по местному времени.
// new Date('2026-09-24') даёт полночь UTC, и к западу от Гринвича выходило 23-е.
describe('parseLocalizedDate: date-only ISO is a local calendar day', () => {
  it('keeps the calendar day regardless of time zone', () => {
    const d = parseLocalizedDate('2026-09-24')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 24]);
    expect(d.getHours()).toBe(0);
  });
});
