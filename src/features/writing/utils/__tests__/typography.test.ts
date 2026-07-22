import { describe, it, expect } from 'vitest';
import { formatRussianTypography } from '../typography';

describe('formatRussianTypography', () => {
  it('replaces straight quotes with guillemets « » based on context', () => {
    const input = '"привет"';
    const res = formatRussianTypography(input, input.length);
    expect(res.text).toBe('«привет»');
  });

  it('replaces double dash with em-dash', () => {
    const input = 'привет -- мир';
    const res = formatRussianTypography(input, input.length);
    expect(res.text).toBe('привет — мир');
  });

  it('replaces space-dash-space with space-em-dash-space', () => {
    const input = 'привет - мир';
    const res = formatRussianTypography(input, input.length);
    expect(res.text).toBe('привет — мир');
  });

  it('replaces triple dot with ellipsis', () => {
    const input = 'далее...';
    const res = formatRussianTypography(input, input.length);
    expect(res.text).toBe('далее…');
  });

  it('adjusts cursor position correctly when characters shrink', () => {
    const input = 'слово... продолжение';
    // Cursor right after '...'
    const cursorPos = 8;
    const res = formatRussianTypography(input, cursorPos);
    expect(res.text).toBe('слово… продолжение');
    expect(res.newCursorPos).toBe(6);
  });
});
