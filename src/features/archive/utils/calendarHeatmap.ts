/**
 * Heatmap quartile calculations for archive calendar cells.
 */

export const HEATMAP_BG_CLASSES: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: '',
  1: 'bg-text-main/10',
  2: 'bg-text-main/20',
  3: 'bg-text-main/35',
  4: 'bg-text-main/55',
};

/**
 * Calculates Q1, Q2 (median), Q3 quartile thresholds from an array of numbers.
 * Non-positive values (<= 0) are excluded from the threshold calculation so empty days don't skew the active scale.
 */
export function calculateQuartiles(values: number[]): [number, number, number] {
  const nonZero = values.filter(v => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) {
    return [0, 0, 0];
  }

  const q = (p: number) => {
    const idx = (nonZero.length - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const weight = idx - lower;
    return nonZero[lower] * (1 - weight) + nonZero[upper] * weight;
  };

  return [q(0.25), q(0.5), q(0.75)];
}

/**
 * Returns a heatmap level from 0 to 4 based on quartile thresholds.
 */
export function levelOf(n: number, thresholds: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  const [q1, q2, q3] = thresholds;
  if (q3 === 0) return 1;
  if (n <= q1) return 1;
  if (n <= q2) return 2;
  if (n <= q3) return 3;
  return 4;
}

/**
 * Creates a helper function levelOf(n) pre-configured with the quartiles of the given dataset.
 */
export function createLevelOf(values: number[]): (n: number) => 0 | 1 | 2 | 3 | 4 {
  const thresholds = calculateQuartiles(values);
  return (n: number) => levelOf(n, thresholds);
}
