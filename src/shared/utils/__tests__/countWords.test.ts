import { countWords } from '../countWords';
import { describe, it, expect } from 'vitest';

describe('countWords', () => {
  it('returns 0 for empty string', () => expect(countWords('')).toBe(0));
  it('counts English words', () => expect(countWords('hello world')).toBe(2));
  it('counts Russian words', () => expect(countWords('привет мир')).toBe(2));
  it('counts mixed language', () => expect(countWords('hello мир')).toBe(2));
  it('ignores extra whitespace', () => expect(countWords('  hello   world  ')).toBe(2));
  it('handles hyphenated words', () => expect(countWords('well-known fact')).toBe(2));
  it('handles emojis', () => expect(countWords('hello 😊 world')).toBe(2));
  it('handles line breaks', () => expect(countWords('hello\nworld')).toBe(2));
  it('handles punctuation-only input', () => expect(countWords('... --- !!!')).toBe(0));
  it('handles very long text', () => {
    const text = 'word '.repeat(10000);
    expect(countWords(text)).toBe(10000);
  });
});
