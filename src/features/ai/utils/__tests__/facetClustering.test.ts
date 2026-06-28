import { describe, it, expect } from 'vitest';
import {
  normalize,
  clusterChunks,
  mergeSimilarClusters,
  suggestK,
  type ChunkItem,
  type Cluster,
} from '../facetClustering';

describe('normalize', () => {
  it('returns a unit L2-length vector for a non-zero input', () => {
    const v = [3, 4];
    const n = normalize(v);
    // L2 norm of the result is 1.
    const mag = Math.sqrt(n.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 10);
    // Direction preserved: [3,4] -> [0.6, 0.8].
    expect(n[0]).toBeCloseTo(0.6, 10);
    expect(n[1]).toBeCloseTo(0.8, 10);
  });

  it('returns a copy of a zero vector with no NaN', () => {
    const z = [0, 0, 0];
    const out = normalize(z);
    expect(out).not.toBe(z); // a copy, not the same reference
    expect(out).toHaveLength(3);
    for (const x of out) {
      expect(Number.isNaN(x)).toBe(false);
      expect(x).toBe(0);
    }
  });
});

describe('clusterChunks', () => {
  it('determinism: same input twice -> identical centroids and noteId membership', () => {
    const items: ChunkItem[] = [
      { noteId: 'a', vector: [1, 0, 0, 0] },
      { noteId: 'a', vector: [0.95, 0.05, 0, 0] },
      { noteId: 'b', vector: [0, 1, 0, 0] },
      { noteId: 'b', vector: [0.05, 0.95, 0, 0] },
      { noteId: 'c', vector: [0, 0, 1, 0] },
      { noteId: 'c', vector: [0, 0.05, 0.95, 0] },
    ];
    const r1 = clusterChunks(items, 3);
    const r2 = clusterChunks(items, 3);
    expect(r2.map(c => c.centroid)).toEqual(r1.map(c => c.centroid));
    expect(r2.map(c => [...c.noteIds].sort())).toEqual(r1.map(c => [...c.noteIds].sort()));
  });

  it('separates two clearly-distant groups into the right buckets', () => {
    const items: ChunkItem[] = [
      { noteId: 'a', vector: [1, 0, 0, 0] },
      { noteId: 'a', vector: [0.99, 0.01, 0, 0] },
      { noteId: 'b', vector: [0, 1, 0, 0] },
      { noteId: 'b', vector: [0.01, 0.99, 0, 0] },
    ];
    const clusters = clusterChunks(items, 2);
    expect(clusters).toHaveLength(2);
    const aCluster = clusters.find(c => c.noteIds.includes('a'));
    const bCluster = clusters.find(c => c.noteIds.includes('b'));
    expect(aCluster).toBeDefined();
    expect(bCluster).toBeDefined();
    expect(aCluster!.noteIds).not.toContain('b');
    expect(bCluster!.noteIds).not.toContain('a');
  });

  it('k larger than points is clamped (no crash, no empty/NaN centroids)', () => {
    const items: ChunkItem[] = [
      { noteId: 'a', vector: [1, 0, 0] },
      { noteId: 'b', vector: [0, 1, 0] },
    ];
    const clusters = clusterChunks(items, 10);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    expect(clusters.length).toBeLessThanOrEqual(2);
    for (const c of clusters) {
      expect(c.noteIds.length).toBeGreaterThan(0);
      expect(c.chunkCount).toBeGreaterThan(0);
      for (const x of c.centroid) {
        expect(Number.isNaN(x)).toBe(false);
      }
    }
  });

  it('a note whose chunks span two clusters appears in BOTH clusters noteIds', () => {
    const items: ChunkItem[] = [
      { noteId: 'a', vector: [1, 0, 0, 0] },
      { noteId: 'b', vector: [0, 1, 0, 0] },
      { noteId: 'x', vector: [1, 0, 0, 0] },
      { noteId: 'x', vector: [0, 1, 0, 0] },
    ];
    const clusters = clusterChunks(items, 2);
    expect(clusters).toHaveLength(2);
    const xClusters = clusters.filter(c => c.noteIds.includes('x'));
    expect(xClusters).toHaveLength(2);
  });
});

describe('mergeSimilarClusters', () => {
  it('merges near-duplicate centroids: union of noteIds, summed chunkCount', () => {
    const clusters: Cluster[] = [
      { centroid: [1, 0, 0], noteIds: ['a', 'b'], texts: [], chunkCount: 2 },
      { centroid: [0.99, 0.01, 0], noteIds: ['b', 'c'], texts: [], chunkCount: 3 },
    ];
    const merged = mergeSimilarClusters(clusters, 0.5);
    expect(merged).toHaveLength(1);
    expect([...merged[0]!.noteIds].sort()).toEqual(['a', 'b', 'c']);
    expect(merged[0]!.chunkCount).toBe(5);
  });

  it('keeps distant centroids as two clusters', () => {
    const clusters: Cluster[] = [
      { centroid: [1, 0, 0], noteIds: ['a'], texts: [], chunkCount: 1 },
      { centroid: [0, 1, 0], noteIds: ['b'], texts: [], chunkCount: 1 },
    ];
    const merged = mergeSimilarClusters(clusters, 0.5);
    expect(merged).toHaveLength(2);
  });

  it('merged centroid equals the chunkCount-weighted, re-normalized mean', () => {
    const c1: Cluster = { centroid: [1, 0, 0], noteIds: ['a'], texts: [], chunkCount: 2 };
    const c2: Cluster = { centroid: [0.99, 0.01, 0], noteIds: ['b'], texts: [], chunkCount: 3 };
    const merged = mergeSimilarClusters([c1, c2], 0.5);
    expect(merged).toHaveLength(1);
    // The function computes normalize(c1.centroid*w1 + c2.centroid*w2) using the
    // raw (un-normalized) centroids, with w1 = c1.chunkCount, w2 = c2.chunkCount.
    const expected = normalize([
      1 * 2 + 0.99 * 3,
      0 * 2 + 0.01 * 3,
      0 * 2 + 0 * 3,
    ]);
    for (let i = 0; i < expected.length; i++) {
      expect(merged[0]!.centroid[i]).toBeCloseTo(expected[i]!, 10);
    }
  });
});

describe('suggestK', () => {
  it('returns 4 for small n (floor)', () => {
    expect(suggestK(4)).toBe(4);
    expect(suggestK(1)).toBe(4);
  });

  it('returns 18 for huge n (ceiling)', () => {
    expect(suggestK(1000)).toBe(18);
  });

  it('returns round(n/4) in the middle', () => {
    expect(suggestK(40)).toBe(10);
  });
});
