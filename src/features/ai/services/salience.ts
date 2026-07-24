import { SALIENCE_CONFIG, SalienceConfig } from './salienceConfig';

export interface SalienceInputs {
  /** Raw count of how many times this theme/concept was reinforced. */
  count: number;
  /** Emotional weight in [0, 1] (clamp01(max(|valence|, arousal))). */
  emotionalWeight: number;
  /** ISO date string or timestamp in ms of most recent note/reinforcement. */
  lastReinforcedAt: string | number;
}

export interface SalienceBreakdown {
  salience: number;
  recencyTerm: number;
  frequencyTerm: number;
  emotionalTerm: number;
}

function parseTimestamp(val: string | number): number {
  if (typeof val === 'number') {
    return Number.isNaN(val) ? 0 : val;
  }
  const parsed = Date.parse(val);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Computes the shared salience (importance currency) score for a candidate item.
 * Pure function: deterministic for a fixed `now`. Computes lazily at ranking time.
 * Total output is strictly in [0, 1].
 */
export function computeSalience(
  inputs: SalienceInputs,
  now: number = Date.now(),
  config: SalienceConfig = SALIENCE_CONFIG
): number {
  return computeSalienceDetailed(inputs, now, config).salience;
}

export function computeSalienceDetailed(
  inputs: SalienceInputs,
  now: number = Date.now(),
  config: SalienceConfig = SALIENCE_CONFIG
): SalienceBreakdown {
  const lastMs = parseTimestamp(inputs.lastReinforcedAt);
  const deltaMs = Math.max(0, now - lastMs);

  // 1. Recency term in [0, 1]
  const recencyTerm = Math.exp(-deltaMs / config.tauMs);

  // 2. Frequency term in [0, 1] (log-damped up to fCap)
  const clampedCount = Math.max(0, inputs.count);
  const cappedCount = Math.min(clampedCount, config.fCap);
  const frequencyTerm = Math.log(1 + cappedCount) / Math.log(1 + config.fCap);

  // 3. Emotional term in [0, 1]
  const emotionalTerm = Math.max(0, Math.min(1, inputs.emotionalWeight || 0));

  // Weighted sum
  const rawSalience =
    config.weightRecency * recencyTerm +
    config.weightFrequency * frequencyTerm +
    config.weightEmotional * emotionalTerm;

  const salience = Math.max(0, Math.min(1, rawSalience));

  return {
    salience,
    recencyTerm,
    frequencyTerm,
    emotionalTerm,
  };
}
