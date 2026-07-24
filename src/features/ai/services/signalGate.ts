export interface SignalThreshold {
  minCount: number;
  minUniqueMonths: number;
}

export interface SignalStats {
  count: number;
  uniqueMonths: number;
}

export const SIGNAL_THRESHOLDS = {
  portrait: { minCount: 20, minUniqueMonths: 1 } as SignalThreshold,
  lexicon: { minCount: 5, minUniqueMonths: 2 } as SignalThreshold,
  themeLedger: { minCount: 3, minUniqueMonths: 1 } as SignalThreshold,
} as const;

export type ArtifactSignalType = keyof typeof SIGNAL_THRESHOLDS;

/**
 * Calculates the number of distinct YYYY-MM calendar months spanned by a set of dates/timestamps.
 */
export function calculateUniqueMonths(dates: (string | number | Date | null | undefined)[]): number {
  const months = new Set<string>();
  for (const d of dates) {
    if (d === null || d === undefined || d === '') continue;

    const dateObj = typeof d === 'object' && d instanceof Date ? d : new Date(d);
    if (isNaN(dateObj.getTime())) continue;
    const yyyyMm = dateObj.toISOString().slice(0, 7); // "YYYY-MM"
    months.add(yyyyMm);
  }
  return months.size;
}

/**
 * B3 Signal Gate Primitive: evaluates whether a dataset satisfies quantity and temporal dispersion requirements.
 * (e.g. 5 notes in 1 week = episode [false]; 5 notes across 2 months = trait [true]).
 */
export function hasEnoughSignal(
  stats: SignalStats | { count: number; dates: (string | number | Date | null | undefined)[] },
  threshold: SignalThreshold
): boolean {
  const count = stats.count;
  const uniqueMonths = 'uniqueMonths' in stats ? stats.uniqueMonths : calculateUniqueMonths(stats.dates);
  return count >= threshold.minCount && uniqueMonths >= threshold.minUniqueMonths;
}
