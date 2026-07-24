import { describe, it, expect } from 'vitest';
import { computeSalience, computeSalienceDetailed } from '../salience';
import { SALIENCE_CONFIG } from '../salienceConfig';

describe('AG-MIND-A1 Salience Importance Currency', () => {
  const NOW = Date.parse('2026-07-24T12:00:00Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('is deterministic for a fixed timestamp and performs no side effects', () => {
    const input = { count: 3, emotionalWeight: 0.5, lastReinforcedAt: '2026-07-20T12:00:00Z' };
    const score1 = computeSalience(input, NOW);
    const score2 = computeSalience(input, NOW);

    expect(score1).toBe(score2);
    expect(score1).toBeGreaterThanOrEqual(0);
    expect(score1).toBeLessThanOrEqual(1);
  });

  it('ensures all terms and total salience are strictly in [0, 1]', () => {
    const extremeLow = computeSalienceDetailed(
      { count: 0, emotionalWeight: -1, lastReinforcedAt: NOW - 365 * DAY_MS },
      NOW
    );
    expect(extremeLow.recencyTerm).toBeGreaterThanOrEqual(0);
    expect(extremeLow.frequencyTerm).toBe(0);
    expect(extremeLow.emotionalTerm).toBe(0);
    expect(extremeLow.salience).toBeGreaterThanOrEqual(0);

    const extremeHigh = computeSalienceDetailed(
      { count: 50, emotionalWeight: 2, lastReinforcedAt: NOW },
      NOW
    );
    expect(extremeHigh.recencyTerm).toBe(1);
    expect(extremeHigh.frequencyTerm).toBe(1);
    expect(extremeHigh.emotionalTerm).toBe(1);
    expect(extremeHigh.salience).toBe(1);
  });

  it('honors recency decay half-life at tau * ln(2) (~62.38 days)', () => {
    const halfLifeDays = SALIENCE_CONFIG.tauDays * Math.log(2);
    const halfLifeMs = halfLifeDays * DAY_MS;

    const fresh = computeSalienceDetailed(
      { count: 1, emotionalWeight: 0, lastReinforcedAt: NOW },
      NOW
    );
    const halfAged = computeSalienceDetailed(
      { count: 1, emotionalWeight: 0, lastReinforcedAt: NOW - halfLifeMs },
      NOW
    );

    expect(fresh.recencyTerm).toBeCloseTo(1.0, 4);
    expect(halfAged.recencyTerm).toBeCloseTo(0.5, 3);
  });

  it('Rumination test (C2 seed): pivotal insight ranks above ruminative cluster', () => {
    // 20 anxious notes on one theme (count=20, low emotional weight=0.2, 30 days old)
    const ruminativeCluster = {
      count: 20,
      emotionalWeight: 0.2,
      lastReinforcedAt: NOW - 30 * DAY_MS,
    };

    // 1 pivotal insight (count=1, high emotional weight=1.0, recent = 1 day old)
    const pivotalInsight = {
      count: 1,
      emotionalWeight: 1.0,
      lastReinforcedAt: NOW - 1 * DAY_MS,
    };

    const ruminationScore = computeSalience(ruminativeCluster, NOW);
    const insightScore = computeSalience(pivotalInsight, NOW);

    expect(insightScore).toBeGreaterThan(ruminationScore);
  });
});
