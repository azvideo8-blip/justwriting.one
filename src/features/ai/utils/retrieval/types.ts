import type { AIEmbeddingService } from '../../services/AIEmbeddingService';

export interface RetrievedNote {
  documentId: string;
  title: string;
  content: string;
  score: number;
  chunkIndex?: number | undefined;
  lastSessionAt?: number | undefined;
}

export const RRF_K = 60;
export const VECTOR_TOP = 40;
export const KEYWORD_TOP = 40;
export const RRF_FINAL = 15;
export const RERANK_THRESHOLD = 0.88;
export const RESURFACE_FLOOR = 0.35;

export const CACHE_TTL_MS = 5 * 60 * 1000;

type EmbeddingEntry = Awaited<ReturnType<typeof AIEmbeddingService.getAll>>[number];
export type { EmbeddingEntry };

export interface SearchNotesOptions {
  queryVector?: number[] | undefined;
  allEmbeddings?: EmbeddingEntry[] | undefined;
  minTime?: number | undefined;
  maxTime?: number | undefined;
  skipRerank?: boolean | undefined;
  onRerankMeta?: ((meta: { bypassed: boolean; bypassReason?: string; rerankLatencyMs?: number; cardCount?: number; rerankFailed?: boolean }) => void) | undefined;
}

export interface CacheResultEntry {
  documentId: string;
  score: number;
  chunkIndex?: number | undefined;
}

// TICKET-047: In-memory semantic query cache
export interface SearchCacheEntry {
  timestamp: number;
  query: string;
  results: CacheResultEntry[];
}
