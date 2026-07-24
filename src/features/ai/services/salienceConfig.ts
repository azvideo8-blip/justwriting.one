/**
 * AG-MIND-A1: Config constants for the shared salience (importance currency) formula.
 * Formula:
 *   salience = w_r * exp(-dt / tau) + w_f * log(1 + count) / log(1 + F_cap) + w_e * emotionalWeight
 */
export interface SalienceConfig {
  /** Half-life scaling constant tau in days. Default = 90 days. */
  tauDays: number;
  /** Tau in milliseconds. Derived from tauDays. */
  tauMs: number;
  /** Frequency cap for log damping. Default = 10. */
  fCap: number;
  /** Weight for recency term w_r in [0, 1]. Default = 0.35. */
  weightRecency: number;
  /** Weight for frequency term w_f in [0, 1]. Default = 0.25. */
  weightFrequency: number;
  /** Weight for emotional weight term w_e in [0, 1]. Default = 0.40. */
  weightEmotional: number;
}

export const SALIENCE_CONFIG: SalienceConfig = {
  tauDays: 90,
  tauMs: 90 * 24 * 60 * 60 * 1000, // 7,776,000,000 ms
  fCap: 10,
  weightRecency: 0.35,
  weightFrequency: 0.25,
  weightEmotional: 0.40,
};
