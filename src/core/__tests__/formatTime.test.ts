import { describe, it, expect } from 'vitest';
import { formatTime } from '../utils/formatTime';

describe('formatTime', () => {
  it('formatTime(0) → "0:00"', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formatTime(59) → "0:59"', () => {
    expect(formatTime(59)).toBe('0:59');
  });

  it('formatTime(60) → "1:00"', () => {
    expect(formatTime(60)).toBe('1:00');
  });

  it('formatTime(61) → "1:01"', () => {
    expect(formatTime(61)).toBe('1:01');
  });

  it('formatTime(599) → "9:59"', () => {
    expect(formatTime(599)).toBe('9:59');
  });

  it('formatTime(600) → "10:00"', () => {
    expect(formatTime(600)).toBe('10:00');
  });

  it('formatTime(3599) → "59:59"', () => {
    expect(formatTime(3599)).toBe('59:59');
  });

  it('formatTime(3600) → "1:00:00"', () => {
    expect(formatTime(3600)).toBe('1:00:00');
  });

  it('formatTime(3661) → "1:01:01"', () => {
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('formatTime(7200) → "2:00:00"', () => {
    expect(formatTime(7200)).toBe('2:00:00');
  });
});
