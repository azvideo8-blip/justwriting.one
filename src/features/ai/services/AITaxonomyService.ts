import { LIFE_DOMAINS, type LifeDomain } from '../utils/lifeDomains';
import { getLocalDb } from '../../../core/storage/localDb';
import { AIService } from './AIService';
import { getSeedVectors } from '../utils/domainSeeds';
import { cosineSimilarity } from '../utils/vectorSearch';
import { useAiLimitStore } from '../store/useAiLimitStore';
import { reportError } from '../../../shared/errors/reportError';

export const TAXONOMY_LS_KEY = 'ai_taxonomy';
export const DERIVED_DEFAULT_THRESHOLD = 0.47;
export const BOOTSTRAP_MIN = 20;
const CONTINUITY_COS = 0.8;

export interface TaxonomyDomain extends LifeDomain {
  derivedAt: number;
  noteCountAtDerive: number;
  source: 'default' | 'derived';
  origin?: 'bootstrap' | 'rederive';
}

interface StoredTaxonomy { version: 1; domains: TaxonomyDomain[] }

let _rederiveInProgress = false;

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

  async ensureBootstrap(): Promise<'bootstrapped' | 'skip'> {
    if (_rederiveInProgress) return 'skip';
    
    const stored = this.getStored();
    if (stored) {
      // staleness check: any label has 0 Cyrillic characters (English taxonomy)
      const hasEnglish = stored.some(d => !/[а-яё]/i.test(d.label));
      if (hasEnglish) {
        console.warn('[AITaxonomyService] Stale (English) taxonomy detected, clearing for re-derive');
        this.clear();
      } else {
        return 'skip';
      }
    }

    // Cooldown/Limit check: require at least 5 remaining daily requests
    const { remaining } = useAiLimitStore.getState();
    if (remaining < 5) return 'skip';

    _rederiveInProgress = true;
    try {
      const res = await deriveAndStore('bootstrap');
      return res === 'ok' ? 'bootstrapped' : 'skip';
    } catch (e) {
      reportError(e, { action: '[AITaxonomyService] ensureBootstrap re-derive failed' });
      return 'skip';
    } finally {
      _rederiveInProgress = false;
    }
  },

  async rederive(): Promise<'ok' | 'skip'> {
    return deriveAndStore('rederive');
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

export function matchLabels(
  prev: TaxonomyDomain[],
  next: { label: string; seed: string }[],
  prevVecs: number[][],
  nextVecs: number[][],
  cosine: (a: number[], b: number[]) => number = cosineSimilarity,
): { label: string; seed: string }[] {
  return next.map((n, i) => {
    const nv = nextVecs[i];
    if (!nv) return n;
    let best = CONTINUITY_COS, bestLabel: string | null = null;
    for (let j = 0; j < prev.length; j++) {
      const pv = prevVecs[j];
      if (!pv) continue;
      const s = cosine(nv, pv);
      if (s >= best) { best = s; bestLabel = prev[j]!.label; }
    }
    return bestLabel ? { label: bestLabel, seed: n.seed } : n;
  });
}

async function deriveAndStore(origin: 'bootstrap' | 'rederive'): Promise<'ok' | 'skip'> {
  const db = await getLocalDb();
  const summaries = await db.getAll('aiSummaries');
  if (summaries.length < BOOTSTRAP_MIN) return 'skip';
  const digest = buildSummaryDigest(summaries);
  if (!digest) return 'skip';

  const res = await AIService.deriveTaxonomy({ digest });
  if (!res.ok || res.domains.length === 0) return 'skip';
  let domains = res.domains;

  const prev = AITaxonomyService.getStored();
  if (origin === 'rederive' && prev && prev.length > 0) {
    const prevVecs = (await getSeedVectors(prev)).map(v => v.vec);
    const nextVecs = (await getSeedVectors(domains.map((d, i) => ({ id: `n${i}`, label: d.label, seed: d.seed })))).map(v => v.vec);
    domains = matchLabels(prev, domains, prevVecs, nextVecs);
  }

  const now = Date.now();
  AITaxonomyService.save(domains.map((d, i) => ({
    id: `tx_${now}_${i}`,
    label: d.label,
    seed: d.seed,
    threshold: DERIVED_DEFAULT_THRESHOLD,
    derivedAt: now,
    noteCountAtDerive: summaries.length,
    source: 'derived',
    origin,
  })));
  return 'ok';
}
