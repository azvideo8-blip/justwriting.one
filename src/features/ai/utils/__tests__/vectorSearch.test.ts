import { describe, it, expect } from 'vitest';
import { cosineSimilarity, topK } from '../vectorSearch';

describe('cosineSimilarity', () => {
  it('identical vectors → score ≈ 1', () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it('orthogonal vectors → score ≈ 0', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
  });

  it('different lengths → 0', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });

  it('zero vectors → 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('empty vectors → 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('topK', () => {
  const items = [
    { id: 'a', vector: [1, 0, 0] },
    { id: 'b', vector: [0, 1, 0] },
    { id: 'c', vector: [0.9, 0.1, 0] },
  ];

  it('returns k items in correct order', () => {
    const result = topK([1, 0, 0], items, 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('a');
    expect(result[0]!.score).toBeCloseTo(1, 10);
    expect(result[1]!.id).toBe('c');
    expect(result[1]!.score).toBeGreaterThan(result[2] === undefined ? 0 : result[2]!.score);
  });

  it('k larger than items → returns all', () => {
    const result = topK([1, 0, 0], items, 10);
    expect(result).toHaveLength(3);
  });

  it('sorted by descending score', () => {
    const result = topK([1, 0, 0], items, 3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
    }
  });
});
