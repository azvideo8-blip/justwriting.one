import { describe, it, expect } from 'vitest';
import { getWpmLevel } from '../wpmColors';

// DC-W6: пороги текстовой отметки скорости. Цвет точки имеет четыре полосы
// (15/35/50), слово — три, и граница между «медленно» и «ровно» — на 15.
describe('DC-W6: getWpmLevel', () => {
  it('границы', () => {
    expect(getWpmLevel(0)).toBe('none');
    expect(getWpmLevel(14)).toBe('slow');
    expect(getWpmLevel(15)).toBe('steady');
    expect(getWpmLevel(49)).toBe('steady');
    expect(getWpmLevel(50)).toBe('fast');
  });
});
