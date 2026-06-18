export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function topK(
  query: number[],
  items: { id: string; vector: number[] }[],
  k: number,
): { id: string; score: number }[] {
  const scored = items.map(item => ({
    id: item.id,
    score: cosineSimilarity(query, item.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Multi-vector ranking: each item has several chunk vectors; its score is the
 * best (max) cosine over its chunks, so a brief on-topic chunk in an otherwise
 * unrelated note still ranks the note highly.
 */
export function topKMulti(
  query: number[],
  items: { id: string; vectors: number[][] }[],
  k: number,
): { id: string; score: number }[] {
  const scored = items.map(item => {
    let best = 0;
    for (const v of item.vectors) {
      const s = cosineSimilarity(query, v);
      if (s > best) best = s;
    }
    return { id: item.id, score: best };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Same as topKMulti but also returns the index of the best-matching chunk
 * for each result, enabling Parent Document Retrieval (load only the
 * matching chunk + its neighbours instead of the whole note).
 */
export function topKMultiWithChunkIndex(
  query: number[],
  items: { id: string; vectors: number[][] }[],
  k: number,
): { id: string; score: number; chunkIndex: number }[] {
  const scored = items.map(item => {
    let best = 0;
    let bestIdx = 0;
    for (let i = 0; i < item.vectors.length; i++) {
      const s = cosineSimilarity(query, item.vectors[i]!);
      if (s > best) { best = s; bestIdx = i; }
    }
    return { id: item.id, score: best, chunkIndex: bestIdx };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
