import { describe, it, expect } from 'vitest';
import { isBlankTitle, normalizeTitle } from '../titleUtils';

describe('titleUtils (RR-1: safe title emptiness check without corrupting emojis or international text)', () => {
  it('identifies null, undefined, and empty/whitespace strings as blank', () => {
    expect(isBlankTitle(null)).toBe(true);
    expect(isBlankTitle(undefined)).toBe(true);
    expect(isBlankTitle('')).toBe(true);
    expect(isBlankTitle('   ')).toBe(true);

    expect(normalizeTitle(null)).toBe('');
    expect(normalizeTitle(undefined)).toBe('');
    expect(normalizeTitle('')).toBe('');
    expect(normalizeTitle('   ')).toBe('');
  });

  it('identifies titles with only invisible Unicode format characters as blank', () => {
    // Zero-width space, zero-width non-joiner, zero-width joiner
    const invisibleOnly = '\u200B\u200C\u200D';
    expect(isBlankTitle(invisibleOnly)).toBe(true);
    expect(normalizeTitle(invisibleOnly)).toBe('');

    expect(isBlankTitle('\uFEFF')).toBe(true);
    expect(normalizeTitle('\uFEFF')).toBe('');
  });

  it('preserves multi-codepoint emoji sequences (does not tear family or job emojis apart)', () => {
    const familyTitle = '👨‍👩‍👧 семья';
    expect(isBlankTitle(familyTitle)).toBe(false);
    expect(familyTitle.length).toBe(14);
    expect(normalizeTitle(familyTitle)).toBe('👨‍👩‍👧 семья');
    expect(normalizeTitle(familyTitle).length).toBe(14);

    const devTitle = '👩‍💻 работа';
    expect(isBlankTitle(devTitle)).toBe(false);
    expect(normalizeTitle(devTitle)).toBe('👩‍💻 работа');

    const flagTitle = '🏳️‍🌈';
    expect(isBlankTitle(flagTitle)).toBe(false);
    expect(normalizeTitle(flagTitle)).toBe('🏳️‍🌈');
  });

  it('preserves Persian, Arabic, and Indic text containing ZWNJ or format characters', () => {
    const persianTitle = 'می‌خواهم';
    expect(isBlankTitle(persianTitle)).toBe(false);
    expect(normalizeTitle(persianTitle)).toBe('می‌خواهم');
  });

  it('trims leading and trailing whitespace while preserving title content', () => {
    expect(normalizeTitle('  Мой заголовок  ')).toBe('Мой заголовок');
    expect(isBlankTitle('  Мой заголовок  ')).toBe(false);
  });
});
