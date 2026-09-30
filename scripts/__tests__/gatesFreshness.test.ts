import { describe, it, expect } from 'vitest';
import { staleGateWarnings } from '../ci/gates-freshness.mjs';

// R5-013/R5-021/R5-053: пропущенный или красный плановый прогон gates.yml
// обязан быть виден. Фальсификация: считать и failure успехом, убрать ветку
// «не найдено» или сравнить возраст не с тем порогом — краснеет.
const NOW = Date.parse('2026-10-01T00:00:00Z');
const SECRETS = 'Full-history secret scan (B-4 / R2-017)';
const HEAVY = 'Testability & Mutations Gates';
const job = (name: string, conclusion: string, completed_at: string) => ({ name, conclusion, completed_at });

describe('gates-freshness', () => {
  it('оба в срок — тишина', () => {
    expect(staleGateWarnings([
      job(SECRETS, 'success', '2026-09-30T09:44:06Z'),
      job(HEAVY, 'success', '2026-09-29T02:39:18Z'),
    ], NOW)).toEqual([]);
  });

  it('красный или пропущенный прогон не считается', () => {
    const w = staleGateWarnings([
      job(SECRETS, 'success', '2026-09-27T09:44:06Z'),
      job(SECRETS, 'failure', '2026-09-30T09:44:06Z'),
      job(HEAVY, 'skipped', '2026-09-30T09:44:06Z'),
    ], NOW);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('3.6 сут');
    expect(w[1]).toContain('не найдено');
  });

  it('недельный порог — 8 суток', () => {
    expect(staleGateWarnings([
      job(SECRETS, 'success', '2026-09-30T20:00:00Z'),
      job(HEAVY, 'success', '2026-09-23T01:00:00Z'),
    ], NOW)).toEqual([]);
    expect(staleGateWarnings([
      job(SECRETS, 'success', '2026-09-30T20:00:00Z'),
      job(HEAVY, 'success', '2026-09-22T23:00:00Z'),
    ], NOW)).toHaveLength(1);
  });
});
