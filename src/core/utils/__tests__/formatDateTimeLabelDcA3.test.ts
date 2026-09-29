import { describe, it, expect } from 'vitest';
import { formatDateTimeLabel } from '../dateUtils';

describe('DC-A3 formatDateTimeLabel: одна строка, sentence case', () => {
  const currentYear = new Date().getFullYear();

  it('текущий год — без года, формат «29 сент., 11:32»', () => {
    const d = new Date(currentYear, 8, 29, 11, 32);
    expect(formatDateTimeLabel(d, 'ru')).toBe('29 сент., 11:32');
  });

  it('прошлый год — с годом, формат «29 сент. 2025, 11:32»', () => {
    const d = new Date(currentYear - 1, 8, 29, 11, 32);
    expect(formatDateTimeLabel(d, 'ru')).toBe(`29 сент. ${currentYear - 1}, 11:32`);
  });

  it('en — «Sep 29, 11:32» без года в текущем году', () => {
    const d = new Date(currentYear, 8, 29, 11, 32);
    expect(formatDateTimeLabel(d, 'en')).toBe('Sep 29, 11:32');
  });

  it('en — прошлый год с годом', () => {
    const d = new Date(currentYear - 1, 8, 29, 11, 32);
    expect(formatDateTimeLabel(d, 'en')).toBe(`Sep 29 ${currentYear - 1}, 11:32`);
  });

  it('никогда не uppercase (нет заглавных кириллических букв)', () => {
    const d = new Date(currentYear, 8, 29, 11, 32);
    const prev = new Date(currentYear - 1, 8, 29, 11, 32);
    expect(formatDateTimeLabel(d, 'ru')).not.toMatch(/[А-ЯЁ]/);
    expect(formatDateTimeLabel(prev, 'ru')).not.toMatch(/[А-ЯЁ]/);
  });

  it('часы и минуты — всегда две цифры (полночь: 00:00)', () => {
    const d = new Date(currentYear, 0, 1, 0, 0);
    expect(formatDateTimeLabel(d, 'ru')).toBe('1 янв., 00:00');
    expect(formatDateTimeLabel(d, 'en')).toBe('Jan 1, 00:00');
  });
});
