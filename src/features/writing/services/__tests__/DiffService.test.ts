import { describe, it, expect } from 'vitest';
import { computeWordDelta } from '../../../../core/services/DiffService';

describe('computeWordDelta', () => {
  it('returns 0 added for identical content', () => {
    const res = computeWordDelta('hello world', 'hello world');
    expect(res.wordsAdded).toBe(0);
    expect(res.charsAdded).toBe(0);
  });

  it('counts added words at the end', () => {
    const res = computeWordDelta('hello', 'hello world');
    expect(res.wordsAdded).toBe(1);
    expect(res.charsAdded).toBe(6); // ' world'
  });

  it('counts added words in the middle', () => {
    const res = computeWordDelta('hello world', 'hello beautiful world');
    expect(res.wordsAdded).toBe(1);
    expect(res.charsAdded).toBe(10); // ' beautiful'
  });

  it('handles completely new content (empty prevContent)', () => {
    const res = computeWordDelta('', 'hello world');
    expect(res.wordsAdded).toBe(2);
    expect(res.charsAdded).toBe(11);
  });

  it('handles deleted content (wordsAdded=0)', () => {
    const res = computeWordDelta('hello world', 'hello');
    expect(res.wordsAdded).toBe(0);
    expect(res.charsAdded).toBe(0);
  });

  it('handles Unicode correctly', () => {
    const res = computeWordDelta('привет', 'привет мир');
    expect(res.wordsAdded).toBe(1);
    expect(res.charsAdded).toBe(4);
  });

  it('handles whitespace-only changes', () => {
    const res = computeWordDelta('hello world', '  hello   world  ');
    expect(res.wordsAdded).toBe(0);
    expect(res.charsAdded).toBe(6);
  });
});
