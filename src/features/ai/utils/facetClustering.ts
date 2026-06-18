// Cosine k-means over chunk vectors. Vectors are L2-normalized so cosine
// similarity == dot product; clustering then uses plain Lloyd iterations.
// Init is deterministic farthest-first (k-means++ without randomness) so a
// rebuild on the same data is stable.

export interface ChunkItem {
  noteId: string;
  vector: number[];
  text?: string;
}

export interface Cluster {
  centroid: number[];
  noteIds: string[];
  texts: string[];
  chunkCount: number;
}

export function normalize(v: number[]): number[] {
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag);
  if (mag === 0) return v.slice();
  return v.map(x => x / mag);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/** Pick k seed indices by farthest-first traversal (max-min cosine distance). */
function farthestFirstSeeds(points: number[][], k: number): number[] {
  const seeds: number[] = [0];
  const minSim = new Array(points.length).fill(-Infinity);
  while (seeds.length < k) {
    const last = points[seeds[seeds.length - 1]!]!;
    let bestIdx = -1;
    let bestDist = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const sim = dot(points[i]!, last);
      if (sim > minSim[i]) minSim[i] = sim;       // closeness to nearest seed
      const dist = 1 - minSim[i];                  // distance to nearest seed
      if (dist > bestDist && !seeds.includes(i)) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    seeds.push(bestIdx);
  }
  return seeds;
}

/**
 * Clusters chunk vectors into up to `k` cosine clusters. Returns clusters with
 * unique member noteIds (a note can land in several clusters via its chunks).
 */
export function clusterChunks(items: ChunkItem[], k: number, iters = 12): Cluster[] {
  if (items.length === 0) return [];
  const points = items.map(it => normalize(it.vector));
  const dim = points[0]!.length;
  k = Math.max(1, Math.min(k, points.length));

  const seeds = farthestFirstSeeds(points, k);
  let centroids = seeds.map(i => points[i]!.slice());
  const assign = new Array(points.length).fill(0);

  for (let iter = 0; iter < iters; iter++) {
    let moved = false;
    // Assign each point to the most similar centroid.
    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = dot(points[i]!, centroids[c]!);
        if (sim > bestSim) { bestSim = sim; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    // Recompute centroids as the normalized mean of their members.
    const sums = centroids.map(() => new Array(dim).fill(0));
    const counts = new Array(centroids.length).fill(0);
    for (let i = 0; i < points.length; i++) {
      const c = assign[i];
      counts[c]++;
      const p = points[i]!;
      const s = sums[c]!;
      for (let d = 0; d < dim; d++) s[d] += p[d]!;
    }
    centroids = sums.map((s, c) => (counts[c] > 0 ? normalize(s.map(x => x / counts[c])) : centroids[c]!));
    if (!moved && iter > 0) break;
  }

  // Build clusters with unique noteIds + their chunk texts.
  const buckets: { noteIds: Set<string>; texts: string[]; chunkCount: number; centroid: number[] }[] =
    centroids.map(centroid => ({ noteIds: new Set<string>(), texts: [], chunkCount: 0, centroid }));
  for (let i = 0; i < items.length; i++) {
    const b = buckets[assign[i]]!;
    b.noteIds.add(items[i]!.noteId);
    const txt = items[i]!.text;
    if (txt) b.texts.push(txt);
    b.chunkCount++;
  }

  return buckets
    .map(b => ({ centroid: b.centroid, noteIds: [...b.noteIds], texts: b.texts, chunkCount: b.chunkCount }))
    .filter(c => c.noteIds.length > 0);
}

/** Heuristic number of facets for a corpus of `noteCount` notes. */
export function suggestK(noteCount: number): number {
  return Math.max(4, Math.min(18, Math.round(noteCount / 4)));
}

/**
 * Greedily merges clusters whose centroids are near-duplicates (cosine >
 * threshold). Over-splitting (e.g. a journaling corpus split into many similar
 * "self-reflection" clusters) collapses into one facet.
 */
export function mergeSimilarClusters(clusters: Cluster[], threshold: number): Cluster[] {
  const kept: Cluster[] = [];
  for (const c of clusters) {
    const cCentroid = normalize(c.centroid);
    let target: Cluster | undefined;
    for (const k of kept) {
      if (dot(cCentroid, normalize(k.centroid)) > threshold) { target = k; break; }
    }
    if (target) {
      const union = new Set([...target.noteIds, ...c.noteIds]);
      target.noteIds = [...union];
      target.texts = [...target.texts, ...c.texts];
      const w1 = target.chunkCount;
      const w2 = c.chunkCount;
      target.centroid = normalize(target.centroid.map((x, i) => x * w1 + (c.centroid[i] ?? 0) * w2));
      target.chunkCount = w1 + w2;
    } else {
      kept.push({ centroid: c.centroid.slice(), noteIds: [...c.noteIds], texts: [...c.texts], chunkCount: c.chunkCount });
    }
  }
  return kept;
}
