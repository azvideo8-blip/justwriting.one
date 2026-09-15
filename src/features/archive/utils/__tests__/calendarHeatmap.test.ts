import { describe, it, expect } from 'vitest';
import { calculateQuartiles, levelOf, createLevelOf, HEATMAP_BG_CLASSES } from '../calendarHeatmap';

describe('calendarHeatmap (UI-11)', () => {
  it('calculates quartiles and levels for [0, 1, 1, 2, 5, 9]', () => {
    const values = [0, 1, 1, 2, 5, 9];
    const thresholds = calculateQuartiles(values);

    // Non-zero values: [1, 1, 2, 5, 9], length 5
    // p=0.25 -> 1, p=0.5 -> 2, p=0.75 -> 5
    expect(thresholds).toEqual([1, 2, 5]);

    const lvl = createLevelOf(values);
    expect(lvl(0)).toBe(0);
    expect(lvl(1)).toBe(1);
    expect(lvl(2)).toBe(2);
    expect(lvl(5)).toBe(3);
    expect(lvl(9)).toBe(4);
  });

  it('handles levelOf directly with thresholds', () => {
    const thresholds: [number, number, number] = [1, 2, 5];
    expect(levelOf(0, thresholds)).toBe(0);
    expect(levelOf(-5, thresholds)).toBe(0);
    expect(levelOf(1, thresholds)).toBe(1);
    expect(levelOf(2, thresholds)).toBe(2);
    expect(levelOf(3, thresholds)).toBe(3);
    expect(levelOf(5, thresholds)).toBe(3);
    expect(levelOf(6, thresholds)).toBe(4);
    expect(levelOf(100, thresholds)).toBe(4);
  });

  it('handles empty or zero-only month values', () => {
    const lvl = createLevelOf([0, 0, 0]);
    expect(lvl(0)).toBe(0);
    // When month has no data, any positive value defaults to level 1
    expect(lvl(10)).toBe(1);
  });

  it('provides static heatmap background classes', () => {
    expect(HEATMAP_BG_CLASSES[0]).toBe('');
    expect(HEATMAP_BG_CLASSES[1]).toBe('bg-text-main/10');
    expect(HEATMAP_BG_CLASSES[2]).toBe('bg-text-main/20');
    expect(HEATMAP_BG_CLASSES[3]).toBe('bg-text-main/35');
    expect(HEATMAP_BG_CLASSES[4]).toBe('bg-text-main/55');
  });
});
