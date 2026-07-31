import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { searchNotesMulti } from '../noteRetriever';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// A retrieval that could not run must not answer "nothing was found": the model
// then tells the user they never wrote about the subject.
describe('searchNotesMulti — a failed search is not an empty archive', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports failed when the query could not be embedded', async () => {
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);

    const result = await searchNotesMulti(['про отца', 'про маму'], 5);

    expect(result.failed).toBe(true);
    expect(result.notes).toEqual([]);
  });

  it('reports failed when the embedding store throws', async () => {
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[0.1, 0.2, 0.3]] } as never);
    vi.spyOn(AIEmbeddingService, 'getAll').mockRejectedValue(new Error('IndexedDB unavailable'));

    const result = await searchNotesMulti(['про отца', 'про маму'], 5);

    expect(result.failed).toBe(true);
  });

  it('does not report failed when the archive genuinely has nothing to match', async () => {
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[0.1, 0.2, 0.3]] } as never);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([]);

    const result = await searchNotesMulti(['про отца', 'про маму'], 5);

    expect(result.failed).toBe(false);
    expect(result.notes).toEqual([]);
  });
});

// The archive was invisible to search whenever the embedding index was empty:
// both paths returned before the keyword search that needs no vectors at all.
describe('searchNotesMulti — no embeddings must not mean no results', () => {
  it('still runs the keyword search and reports the index as degraded', async () => {
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[0.1, 0.2, 0.3]] } as never);
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([]);

    const result = await searchNotesMulti(['про Сашу', 'Саша'], 5);

    expect(result.failed).toBe(false);
    expect(result.degraded).toBe(true);
  });
});
