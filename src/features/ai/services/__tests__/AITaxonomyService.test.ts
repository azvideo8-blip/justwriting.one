import { describe, it, expect, beforeEach } from 'vitest';
import { AITaxonomyService, type TaxonomyDomain } from '../AITaxonomyService';
import { LIFE_DOMAINS } from '../../utils/lifeDomains';

const sample: TaxonomyDomain = {
  id: 'd_calling', label: 'Призвание', seed: 'смысл и призвание, кем быть',
  threshold: 0.47, derivedAt: 1, noteCountAtDerive: 40, source: 'derived', origin: 'bootstrap',
};

describe('AITaxonomyService storage', () => {
  beforeEach(() => localStorage.clear());

  it('getStored returns null when nothing saved', () => {
    expect(AITaxonomyService.getStored()).toBeNull();
  });

  it('save then getStored round-trips', () => {
    AITaxonomyService.save([sample]);
    expect(AITaxonomyService.getStored()).toEqual([sample]);
  });

  it('getActive falls back to LIFE_DOMAINS when no taxonomy stored', async () => {
    const active = await AITaxonomyService.getActive();
    expect(active).toEqual(LIFE_DOMAINS);
  });

  it('getActive returns stored domains (as LifeDomain) when present', async () => {
    AITaxonomyService.save([sample]);
    const active = await AITaxonomyService.getActive();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: 'd_calling', label: 'Призвание', seed: sample.seed, threshold: 0.47 });
  });

  it('clear removes the taxonomy', () => {
    AITaxonomyService.save([sample]);
    AITaxonomyService.clear();
    expect(AITaxonomyService.getStored()).toBeNull();
  });
});
