import { describe, it, expect } from 'vitest';
import { simulateCounts, tuneThresholds, type SimChunk, type SimDomain } from '../thresholdTuner';

// Unit vectors so cosine == dot product. 2 domains along the axes.
const dA: SimDomain = { id: 'A', vec: [1, 0], threshold: 0.8 };
const dB: SimDomain = { id: 'B', vec: [0, 1], threshold: 0.8 };

describe('simulateCounts', () => {
  it('assigns a chunk to its best passing domain (primary)', () => {
    const chunks: SimChunk[] = [{ noteId: 'n1', vector: [1, 0] }]; // sim A=1, B=0
    const c = simulateCounts(chunks, [dA, dB]);
    expect(c.get('A')).toBe(1);
    expect(c.get('B')).toBe(0);
  });

  it('a chunk passing no domain is leftover (counted nowhere)', () => {
    const chunks: SimChunk[] = [{ noteId: 'n1', vector: [0.6, 0.6] }]; // sim ~0.42 each < 0.5
    const c = simulateCounts(chunks, [dA, dB]);
    expect(c.get('A')).toBe(0);
    expect(c.get('B')).toBe(0);
  });

  it('a secondary needs threshold + 0.03 once a primary exists', () => {
    // chunk near A (passes), and B at simB=0.5 — must NOT count as secondary
    // because secondary needs >= 0.83 (threshold 0.8 + 0.03).
    const chunks: SimChunk[] = [{ noteId: 'n1', vector: [0.866, 0.5] }]; // simA=0.866, simB=0.5
    const c = simulateCounts(chunks, [dA, dB]);
    expect(c.get('A')).toBe(1);
    expect(c.get('B')).toBe(0);
  });

  it('counts unique notes, not chunks', () => {
    const chunks: SimChunk[] = [
      { noteId: 'n1', vector: [1, 0] },
      { noteId: 'n1', vector: [0.99, 0.01] },
    ];
    const c = simulateCounts(chunks, [dA, dB]);
    expect(c.get('A')).toBe(1);
  });
});

describe('tuneThresholds', () => {
  it('raises the threshold of an over-binding domain until its share drops', () => {
    // Domain A at threshold 0.40 captures everything; B captures little.
    const dA: SimDomain = { id: 'A', vec: [1, 0], threshold: 0.40 };
    const dB: SimDomain = { id: 'B', vec: [0, 1], threshold: 0.40 };
    // 10 notes all leaning A; only 1 toward B.
    const chunks: SimChunk[] = [
      ...Array.from({ length: 9 }, (_, i) => ({ noteId: `a${i}`, vector: [1, 0] })),
      { noteId: 'b0', vector: [0, 1] },
    ];
    const res = tuneThresholds(chunks, [dA, dB], 10);
    // A over-binds (9/10 = 90% > 40%) -> its threshold must have risen above 0.40.
    expect(res.thresholds.get('A')!).toBeGreaterThan(0.40);
    expect(res.iterations).toBeLessThanOrEqual(20);
  });

  it('keeps thresholds inside [0.40, 0.60]', () => {
    const dA: SimDomain = { id: 'A', vec: [1, 0], threshold: 0.59 };
    const chunks: SimChunk[] = Array.from({ length: 20 }, (_, i) => ({ noteId: `n${i}`, vector: [1, 0] }));
    const res = tuneThresholds(chunks, [dA], 20);
    expect(res.thresholds.get('A')!).toBeLessThanOrEqual(0.60);
    expect(res.thresholds.get('A')!).toBeGreaterThanOrEqual(0.40);
  });

  it('is a fixed point: running again from the result changes nothing', () => {
    const dA: SimDomain = { id: 'A', vec: [1, 0], threshold: 0.40 };
    const dB: SimDomain = { id: 'B', vec: [0, 1], threshold: 0.40 };
    const chunks: SimChunk[] = [
      ...Array.from({ length: 9 }, (_, i) => ({ noteId: `a${i}`, vector: [1, 0] })),
      { noteId: 'b0', vector: [0, 1] },
    ];
    const first = tuneThresholds(chunks, [dA, dB], 10);
    const settled: SimDomain[] = [
      { id: 'A', vec: [1, 0], threshold: first.thresholds.get('A')! },
      { id: 'B', vec: [0, 1], threshold: first.thresholds.get('B')! },
    ];
    const second = tuneThresholds(chunks, settled, 10);
    expect(second.changed).toBe(0);
  });
});
