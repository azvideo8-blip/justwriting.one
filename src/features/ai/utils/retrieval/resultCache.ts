import { CACHE_TTL_MS } from './types';
import type { CacheResultEntry, SearchCacheEntry } from './types';

export const searchCache: SearchCacheEntry[] = [];
export type { CacheResultEntry };

export const MAX_CACHE_ENTRIES = 50;

// TICKET-047: Cache helpers
export function cleanCache() {
  const limit = Date.now() - CACHE_TTL_MS;
  while (searchCache.length > 0 && searchCache[0]!.timestamp < limit) {
    searchCache.shift();
  }
}

export function getCached(query: string): CacheResultEntry[] | null {
  const q = query.trim().toLowerCase();
  const entry = searchCache.find(c => c.query.trim().toLowerCase() === q);
  return entry ? entry.results : null;
}

export function putCache(query: string, results: RetrievedNoteForCache[]) {
  if (searchCache.length >= MAX_CACHE_ENTRIES) {
    searchCache.shift();
  }
  const cachedResults: CacheResultEntry[] = results.map(r => ({
    documentId: r.documentId,
    score: r.score,
    chunkIndex: r.chunkIndex,
  }));
  searchCache.push({ timestamp: Date.now(), query, results: cachedResults });
}

interface RetrievedNoteForCache {
  documentId: string;
  score: number;
  chunkIndex?: number | undefined;
}
