import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readTourState, writeTourState } from '../tourState';

describe('TR-1: отметка знакомства', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('нет записи → null', () => {
    expect(readTourState('u1')).toBeNull();
  });
  it('запись читается и принадлежит своему аккаунту', () => {
    writeTourState('u1', 'skipped:2');
    expect(localStorage.getItem('jw_tour_v1_u1')).toBe('skipped:2');
    expect(readTourState('u1')).toBe('skipped:2');
    expect(readTourState('u2')).toBeNull();
    writeTourState('u1', 'done');
    expect(readTourState('u1')).toBe('done');
  });
  it('мусор в записи → done (повторно не показываем)', () => {
    localStorage.setItem('jw_tour_v1_u1', '{"oops":1}');
    expect(readTourState('u1')).toBe('done');
    localStorage.setItem('jw_tour_v1_u1', 'skipped:0');
    expect(readTourState('u1')).toBe('done');
  });
  // Мутация: `catch { return null }` → красный (молчащее хранилище прошло бы как «не показывали»).
  it('хранилище бросает → unknown, а не null', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readTourState('u1')).toBe('unknown');
  });
  it('запись в недоступное хранилище не бросает', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => writeTourState('u1', 'done')).not.toThrow();
  });
});
