import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rerankNotes } from '../rerankNotes';

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((_opts: unknown, handler: Function) => handler),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  },
}));

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  FieldValue: {
    increment: vi.fn((n: number) => ({ _increment: n })),
    serverTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  },
}));

vi.mock('../../shared/firestore', () => ({
  getDb: vi.fn(() => ({})),
  FIRESTORE_DATABASE_ID: 'test-db',
}));

vi.mock('../../shared/aiProvider', () => ({
  generate: vi.fn(),
}));

vi.mock('../../shared/aiUtils', () => ({
  sanitizeAiInput: vi.fn((s: string) => s),
  hasInjectionAttempt: vi.fn(() => false),
  recordUsage: vi.fn().mockResolvedValue(undefined),
  tryReserveGlobalRequest: vi.fn().mockResolvedValue(true),
  refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
  checkAndIncrementBulkLimit: vi.fn().mockResolvedValue(true),
  refundBulkLimit: vi.fn().mockResolvedValue(undefined),
}));

import { generate } from '../../shared/aiProvider';
import { tryReserveGlobalRequest, refundGlobalRequest } from '../../shared/aiUtils';

describe('rerankNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dummyAuth = { uid: 'test-user-123' };

  it('throws unauthenticated if no auth', async () => {
    await expect(
      (rerankNotes as any)({ data: { query: 'test', candidates: [{ documentId: 'doc1', card: 'card1' }] }, auth: null })
    ).rejects.toThrow('Registration required.');
  });

  it('throws invalid-argument on invalid payload', async () => {
    await expect(
      (rerankNotes as any)({ data: { query: '', candidates: [] }, auth: dummyAuth })
    ).rejects.toThrow('Invalid payload.');
  });

  it('throws resource-exhausted if global request reservation fails', async () => {
    vi.mocked(tryReserveGlobalRequest).mockResolvedValueOnce(false);
    await expect(
      (rerankNotes as any)({ data: { query: 'test', candidates: [{ documentId: 'doc1', card: 'card1' }] }, auth: dummyAuth })
    ).rejects.toThrow('Free-tier daily limit reached');
  });

  it('validates returned IDs and filters out hallucinated IDs', async () => {
    vi.mocked(generate).mockResolvedValueOnce({
      text: JSON.stringify({ ids: ['doc1', 'hallucinated-doc', 'doc2'] }),
      tokensIn: 10,
      tokensOut: 5,
      model: 'test-model',
    });

    const res = await (rerankNotes as any)({
      data: {
        query: 'search query',
        candidates: [
          { documentId: 'doc1', card: 'this is doc 1' },
          { documentId: 'doc2', card: 'this is doc 2' },
        ],
      },
      auth: dummyAuth,
    });

    expect(res).toEqual({ documentIds: ['doc1', 'doc2'] });
  });

  it('refunds global request and throws on generate failures', async () => {
    vi.mocked(generate).mockRejectedValueOnce(new Error('API failure'));

    await expect(
      (rerankNotes as any)({ data: { query: 'test', candidates: [{ documentId: 'doc1', card: 'card1' }] }, auth: dummyAuth })
    ).rejects.toThrow('Rerank failed.');

    expect(refundGlobalRequest).toHaveBeenCalled();
  });
});
