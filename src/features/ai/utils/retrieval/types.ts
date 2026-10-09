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
export const RESURFACE_FLOOR = 0.35;
/**
 * П-4 (замер 08.10.2026, 116 запросов): блок «Возможно релевантные заметки»
 * клал топ-3 без всякого порога, и на запросах без ответа это был чистый шум —
 * 3,6 заметки на none-запрос. Порог 0,50 по исходному косинусу — единственная
 * правка порога, подтверждённая на обеих половинах разметки: мусор 0,83 → 0,82,
 * none-заметки 3,58 → 2,75, релевантные в контексте минус 0,01.
 */
export const LITE_FLOOR = 0.5;

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
