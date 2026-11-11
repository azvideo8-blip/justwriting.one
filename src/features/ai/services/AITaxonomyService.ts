import { LIFE_DOMAINS, type LifeDomain } from '../utils/lifeDomains';
import { reportError } from '../../../shared/errors/reportError';
import { getCurrentUser } from '../../../core/auth';

export function taxonomyKey(uid: string | null | undefined): string {
  return uid ? `ai_taxonomy_${uid}` : 'ai_taxonomy_guest';
}

export const TAXONOMY_LS_KEY = 'ai_taxonomy';

export interface TaxonomyDomain extends LifeDomain {
  derivedAt: number;
  noteCountAtDerive: number;
  source: 'default' | 'derived';
  origin?: 'bootstrap' | 'rederive';
}

interface StoredTaxonomy { version: 1; domains: TaxonomyDomain[] }

export const AITaxonomyService = {
  getStored(): TaxonomyDomain[] | null {
    const uid = getCurrentUser()?.uid;
    const key = taxonomyKey(uid);
    let raw = localStorage.getItem(key);
    if (!raw && uid) {
      const legacy = localStorage.getItem(TAXONOMY_LS_KEY);
      if (legacy) {
        try {
          localStorage.setItem(key, legacy);
          localStorage.removeItem(TAXONOMY_LS_KEY);
        } catch { /* ignore */ }
        raw = legacy;
      }
    } else if (raw) {
      try {
        localStorage.removeItem(TAXONOMY_LS_KEY);
      } catch { /* ignore */ }
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredTaxonomy;
      return Array.isArray(parsed.domains) && parsed.domains.length > 0 ? parsed.domains : null;
    } catch (e) {
      reportError(e, { action: 'AITaxonomyService/getTaxonomy' });
      return null;
    }
  },

  save(domains: TaxonomyDomain[]): void {
    const uid = getCurrentUser()?.uid;
    const key = taxonomyKey(uid);
    const payload: StoredTaxonomy = { version: 1, domains };
    try {
      localStorage.setItem(key, JSON.stringify(payload));
      localStorage.removeItem(TAXONOMY_LS_KEY);
    } catch { /* намеренно: кэш таксономии, пересчитается */ }
  },

  clear(): void {
    const uid = getCurrentUser()?.uid;
    const key = taxonomyKey(uid);
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(TAXONOMY_LS_KEY);
    } catch { /* намеренно: хранилище недоступно — и кэша в нём нет */ }
  },

  // The single seam build() reads. Stored taxonomy if present, else the
  // hardcoded universal defaults (cold-start).
  async getActive(): Promise<LifeDomain[]> {
    const stored = this.getStored();
    if (!stored) return LIFE_DOMAINS;
    return stored.map(d => {
      const base: LifeDomain = { id: d.id, label: d.label, seed: d.seed };
      if (d.threshold !== undefined) base.threshold = d.threshold;
      return base;
    });
  },
};
