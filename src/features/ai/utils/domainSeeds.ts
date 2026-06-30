import { AIService } from '../services/AIService';
import { LIFE_DOMAINS, type LifeDomain } from './lifeDomains';
import { CURRENT_EMBED_MODEL, CURRENT_EMBED_DIM } from './embeddingIndexer';

export interface DomainSeedVec {
  id: string;
  label: string;
  vec: number[];
  threshold: number;
}

// Default per-domain cosine threshold. Mirrors the production DOMAIN_THRESHOLD
// in AIProfileFacetService without importing it (this module must not depend on
// or modify the production facet build flow).
const DEFAULT_DOMAIN_THRESHOLD = 0.45;

type CachedSeeds = { key: string; vecs: DomainSeedVec[] };

// Module-level in-memory cache. Lives for the browser session; re-embeds once
// after a reload. Keyed by model+dim so an embedding-model swap invalidates it.
// No IndexedDB, no localStorage, no schema changes.
let domainSeedCache: CachedSeeds | null = null;

/** Test hook: clears the module cache so cases are isolated. */
export function __resetDomainSeedCache(): void {
  domainSeedCache = null;
}

function listKey(domains: LifeDomain[]): string {
  return domains.map(d => `${d.id}:${d.seed.length}`).join('|');
}

/**
 * Embeds each domain seed via AIService.embed exactly once per model+dim+list,
 * then caches the result. Subsequent calls with the same key return the cache
 * without calling embed again. Domains whose embed fails are skipped; if all
 * fail, returns [].
 */
export async function getSeedVectors(domains: LifeDomain[]): Promise<DomainSeedVec[]> {
  const cacheKey = `${CURRENT_EMBED_MODEL}:${CURRENT_EMBED_DIM}:${listKey(domains)}`;
  if (domainSeedCache && domainSeedCache.key === cacheKey) {
    return domainSeedCache.vecs;
  }

  const vecs: DomainSeedVec[] = [];
  for (const d of domains) {
    const res = await AIService.embed({ content: d.seed });
    if (!res.ok || !res.vectors[0]) continue;
    vecs.push({
      id: d.id,
      label: d.label,
      vec: res.vectors[0],
      threshold: d.threshold ?? DEFAULT_DOMAIN_THRESHOLD,
    });
  }

  domainSeedCache = { key: cacheKey, vecs };
  return vecs;
}

/**
 * Thin wrapper over getSeedVectors for the hardcoded LIFE_DOMAINS list so
 * FacetDiagnostics and other callers are unaffected.
 */
export async function getDomainSeedVectors(): Promise<DomainSeedVec[]> {
  return getSeedVectors(LIFE_DOMAINS);
}
