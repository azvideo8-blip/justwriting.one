import { LIFE_DOMAINS, type LifeDomain } from '../utils/lifeDomains';

export const TAXONOMY_LS_KEY = 'ai_taxonomy';
export const DERIVED_DEFAULT_THRESHOLD = 0.47;

export interface TaxonomyDomain extends LifeDomain {
  derivedAt: number;
  noteCountAtDerive: number;
  source: 'default' | 'derived';
  origin?: 'bootstrap' | 'rederive';
}

interface StoredTaxonomy { version: 1; domains: TaxonomyDomain[] }

export const AITaxonomyService = {
  getStored(): TaxonomyDomain[] | null {
    const raw = localStorage.getItem(TAXONOMY_LS_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoredTaxonomy;
      return Array.isArray(parsed.domains) && parsed.domains.length > 0 ? parsed.domains : null;
    } catch {
      return null;
    }
  },

  save(domains: TaxonomyDomain[]): void {
    const payload: StoredTaxonomy = { version: 1, domains };
    localStorage.setItem(TAXONOMY_LS_KEY, JSON.stringify(payload));
  },

  clear(): void {
    localStorage.removeItem(TAXONOMY_LS_KEY);
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

export interface SummaryLike {
  themes?: string[];
  insights?: string[];
  mentionedPeople?: { name: string; role: string }[];
}

export function buildSummaryDigest(summaries: SummaryLike[], maxNotes = 200): string {
  const blocks: string[] = [];
  for (const s of summaries.slice(0, maxNotes)) {
    const themes = (s.themes ?? []).filter(Boolean);
    const insights = (s.insights ?? []).filter(Boolean);
    const people = (s.mentionedPeople ?? []).map(p => `${p.name} (${p.role})`).filter(Boolean);
    if (themes.length === 0 && insights.length === 0 && people.length === 0) continue;
    const parts: string[] = [];
    if (themes.length) parts.push(`Темы: ${themes.join(', ')}`);
    if (insights.length) parts.push(`Инсайты: ${insights.join('; ')}`);
    if (people.length) parts.push(`Люди: ${people.join(', ')}`);
    blocks.push(parts.join('\n'));
  }
  return blocks.join('\n---\n');
}
