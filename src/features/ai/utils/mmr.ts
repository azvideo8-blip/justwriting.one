/**
 * Maximal Marginal Relevance (MMR) selection algorithm.
 * Balances relevance/salience against diversity (penalizing redundant/duplicate items).
 *
 * Score(u) = lambda * RawScore(u) - (1 - lambda) * max_{s in Selected} Similarity(u, s)
 */
export function selectWithMMR<T>(
  items: T[],
  getSimilarity: (a: T, b: T) => number,
  getRawScore: (item: T) => number,
  lambda = 0.7,
  topK?: number
): T[] {
  if (items.length === 0 || topK === 0) return [];
  const limit = topK !== undefined ? Math.min(topK, items.length) : items.length;

  const remaining = [...items];
  const selected: T[] = [];

  // Sort initially by raw score descending to break ties deterministically
  remaining.sort((a, b) => getRawScore(b) - getRawScore(a));

  // Select the highest raw score item first
  const first = remaining.shift();
  if (!first) return [];
  selected.push(first);

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = -1;
    let maxMMR = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      const raw = getRawScore(candidate);

      // Compute maximum similarity to any already-selected item
      let maxSim = 0;
      for (const sel of selected) {
        const sim = getSimilarity(candidate, sel);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = lambda * raw - (1 - lambda) * maxSim;

      if (mmrScore > maxMMR) {
        maxMMR = mmrScore;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      const chosen = remaining.splice(bestIndex, 1)[0];
      if (chosen) {
        selected.push(chosen);
      }
    } else {
      break;
    }
  }


  return selected;
}

/** Helper string Jaccard similarity for text candidates when dense vector embeddings are absent. */
export function textJaccardSimilarity(textA: string, textB: string): number {
  const setA = new Set(textA.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(textB.toLowerCase().split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}
