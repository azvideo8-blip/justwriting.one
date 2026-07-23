import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isOversizedError, saveEmbeddingToCloud } from '../AIEmbeddingService';
import type { AIDocumentEmbedding } from '../../../../core/storage/localDb';

vi.mock('../../../../core/firebase/firestoreClient', () => ({
  getClient: vi.fn().mockResolvedValue({
    db: {},
    mod: {
      doc: vi.fn(),
      setDoc: vi.fn().mockResolvedValue(undefined),
    },
  }),
}));

vi.mock('../../../../core/crypto/cryptoHelpers', () => ({
  maybeEncrypt: vi.fn(async (payload: Record<string, unknown>) => payload),
  maybeDecrypt: vi.fn(async (data: Record<string, unknown>) => data),
}));

describe('AIEmbeddingService — Size Guard & Error Handler (EMB-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('identifies oversized document errors correctly', () => {
    expect(isOversizedError("Document '.../embeddings/local_123' cannot be written because its size (1,077,976 bytes) exceeds the maximum allowed size of 1,048,576 bytes.")).toBe(true);
    expect(isOversizedError('invalid-argument: payload size limit')).toBe(true);
    expect(isOversizedError('document size too large')).toBe(true);
    expect(isOversizedError('ERR_NETWORK_CHANGED')).toBe(false);
    expect(isOversizedError('unavailable')).toBe(false);
  });

  it('saves standard-sized embeddings to cloud without shrinking', async () => {
    const emb: AIDocumentEmbedding = {
      documentId: 'doc_normal',
      vectors: [[0.1, 0.2, 0.3]],
      chunkTexts: ['normal chunk text'],
      model: 'qwen/qwen3-embedding-8b',
      dim: 3,
      contentHash: 'hash123',
      processedAt: 123456789,
    };

    const res = await saveEmbeddingToCloud('user_123', emb);
    expect(res.skipped).toBe(false);
  });

  it('attempts shrinking by omitting chunkTextsJson if initial payload exceeds 1MB', async () => {
    const hugeChunkText = 'a'.repeat(600_000);
    const emb: AIDocumentEmbedding = {
      documentId: 'doc_large',
      vectors: [[0.1, 0.2]],
      chunkTexts: [hugeChunkText, hugeChunkText], // > 1MB with chunkTexts
      model: 'qwen/qwen3-embedding-8b',
      dim: 2,
      contentHash: 'hash123',
      processedAt: 123456789,
    };

    const res = await saveEmbeddingToCloud('user_123', emb);
    // After omitting chunkTextsJson, the remaining vectors payload fits under 1MB
    expect(res.skipped).toBe(false);
  });

  it('returns skipped: true if payload exceeds 1MB even after dropping chunkTexts', async () => {
    // Generate massive vectors array > 1MB
    const hugeVectors = Array.from({ length: 500 }, () => Array.from({ length: 500 }, (_, i) => i * 0.123456789));
    const emb: AIDocumentEmbedding = {
      documentId: 'doc_massive',
      vectors: hugeVectors,
      chunkTexts: ['some text'],
      model: 'qwen/qwen3-embedding-8b',
      dim: 500,
      contentHash: 'hash123',
      processedAt: 123456789,
    };

    const res = await saveEmbeddingToCloud('user_123', emb);
    expect(res.skipped).toBe(true);
  });
});
