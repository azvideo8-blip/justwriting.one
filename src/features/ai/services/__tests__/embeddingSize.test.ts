import { describe, it, expect } from 'vitest';

/**
 * The Firestore free-tier quota is measured in write units that scale with
 * document size. On 2026-07-28 and 07-29 the 40k daily allowance was consumed
 * entirely; at 4096 dimensions a full-precision embedding serialises to
 * hundreds of KB, so a few dozen uploads are enough. This pins the size
 * reduction that made the cap meaningful.
 */
function roundVectors(vectors: number[][]): number[][] {
  return vectors.map(chunk => chunk.map(v => Math.round(v * 1e6) / 1e6));
}

function makeChunk(dim: number, seed: number): number[] {
  // Values shaped like a normalised embedding: small, many significant digits.
  return Array.from({ length: dim }, (_, i) => Math.sin(seed + i) / 41.7);
}

describe('embedding cloud payload size', () => {
  it('rounding cuts a 4096-dim payload roughly in half', () => {
    const vectors = [makeChunk(4096, 1), makeChunk(4096, 2), makeChunk(4096, 3)];

    const raw = JSON.stringify(vectors).length;
    const rounded = JSON.stringify(roundVectors(vectors)).length;

    expect(rounded).toBeLessThan(raw * 0.6);
  });

  it('keeps enough precision that cosine similarity is unchanged', () => {
    const a = makeChunk(4096, 7);
    const b = makeChunk(4096, 9);
    const cosine = (x: number[], y: number[]) => {
      let dot = 0, nx = 0, ny = 0;
      for (let i = 0; i < x.length; i++) {
        dot += x[i]! * y[i]!;
        nx += x[i]! * x[i]!;
        ny += y[i]! * y[i]!;
      }
      return dot / (Math.sqrt(nx) * Math.sqrt(ny));
    };

    const before = cosine(a, b);
    const [ra, rb] = roundVectors([a, b]);
    const after = cosine(ra!, rb!);

    // Six decimals on a normalised vector is well below what ranking can see.
    expect(Math.abs(after - before)).toBeLessThan(1e-6);
  });
});
