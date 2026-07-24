import { describe, it, expect } from 'vitest';
import { selectWithMMR, textJaccardSimilarity } from '../mmr';

describe('MMR Diversity Selection', () => {
  it('selects highest raw score item first', () => {
    const items = [
      { id: 1, text: 'apple pie', score: 0.5 },
      { id: 2, text: 'banana bread', score: 0.9 },
      { id: 3, text: 'apple tart', score: 0.8 },
    ];

    const result = selectWithMMR(
      items,
      (a, b) => textJaccardSimilarity(a.text, b.text),
      item => item.score,
      0.7,
      2
    );

    expect(result[0]!.id).toBe(2); // highest score (0.9)

  });

  it('penalizes near-duplicate items in favor of diverse candidates', () => {
    const items = [
      { id: 'a', text: 'anxiety self-doubt impostor syndrome', score: 0.95 },
      { id: 'b', text: 'anxiety self-doubt impostor syndrome pattern', score: 0.90 }, // near duplicate of a
      { id: 'c', text: 'career progress promotion leadership', score: 0.70 }, // diverse
    ];

    const selected = selectWithMMR(
      items,
      (x, y) => textJaccardSimilarity(x.text, y.text),
      i => i.score,
      0.5, // strong diversity penalty
      2
    );

    expect(selected.map(i => i.id)).toEqual(['a', 'c']);
  });

  it('computes Jaccard similarity correctly', () => {
    expect(textJaccardSimilarity('hello world', 'hello world')).toBe(1.0);
    expect(textJaccardSimilarity('hello world', 'foo bar')).toBe(0.0);
    expect(textJaccardSimilarity('cat dog mouse', 'cat bird mouse')).toBe(2 / 4); // 0.5
  });
});
