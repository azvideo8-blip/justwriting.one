import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { searchNotes } from '../noteRetriever';
import { AIService } from '../../services/AIService';
import { AIEmbeddingService } from '../../services/AIEmbeddingService';
import { getLocalDb } from '../../../../core/storage/localDb';
import { LocalVersionService } from '../../../../core/services/LocalVersionService';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// Searching for a person by name is a keyword match, not a semantic one: the
// name is written in the note, and a short query has low cosine similarity to a
// long entry. The relevance floor scored such notes 0 — they were never in the
// vector results — and dropped them, so "поищи про Вику" answered "nothing
// found" while the note sat in the archive with her name in it.
describe('searchNotes — a keyword-only match survives the relevance floor', () => {
  const NOTE_ID = 'local_vika_note';
  const OTHER_ID = 'local_other_note';

  beforeEach(async () => {
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of ['documents', 'versions'] as const) {
      const all = await db.getAll(store);
      for (const rec of all) await db.delete(store, (rec as { id: string }).id);
    }
    await db.put('documents', {
      id: NOTE_ID, guestId: 'u1', title: 'Обычный день', currentVersion: 1,
      totalWords: 10, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 1000, lastSessionAt: 1000, tags: [],
    } as never);
    await db.put('documents', {
      id: OTHER_ID, guestId: 'u1', title: 'Другое', currentVersion: 1,
      totalWords: 10, totalDuration: 0, sessionsCount: 1,
      firstSessionAt: 2000, lastSessionAt: 2000, tags: [],
    } as never);

    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) =>
      id === NOTE_ID
        ? 'Сегодня возил Вику в школу, потом обсуждали лагерь на лето.'
        : 'Совершенно посторонний текст про работу и дедлайны.',
    );
  });

  it('returns the note that mentions the name, with embeddings present', async () => {
    // Embeddings exist (so the index is NOT reported as unavailable) but they
    // are unrelated to the query — the classic case this filter broke.
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([
      { documentId: OTHER_ID, vectors: [[1, 0, 0]], contentHash: 'h', processedAt: 1, model: 'm', dim: 3 },
    ] as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[0, 1, 0]] } as never);
    vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' } as never);

    const results = await searchNotes('поищи про Вику', 5);

    expect(results.map(r => r.documentId)).toContain(NOTE_ID);
  });
});

// A name search used to pay for a cloud rerank round-trip on every query. A
// candidate whose text literally contains the name is stronger evidence than
// anything the reranker adds — and the check is local.
describe('searchNotes — a literal name match skips the cloud rerank', () => {
  const NOTE_ID = 'local_vika_note';

  it('does not call rerank when the note literally contains the name', async () => {
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[0, 1, 0]] } as never);
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'x' } as never);

    const results = await searchNotes('поищи про Вику', 5);

    expect(results.map(r => r.documentId)).toContain(NOTE_ID);
    expect(rerank).not.toHaveBeenCalled();
  });

  it('matches the name through its case ending', async () => {
    // The query says «Вику», the note says «Вику»/«Вика» — a plain substring
    // check on the query word finds nothing once the endings differ.
    vi.spyOn(LocalVersionService, 'getLatestContent').mockImplementation(async (id: string) =>
      id === NOTE_ID ? 'Вчера Вика первый раз поехала в лагерь.' : 'Ничего общего.',
    );
    vi.spyOn(AIEmbeddingService, 'getAll').mockResolvedValue([] as never);
    vi.spyOn(AIService, 'embed').mockResolvedValue({ ok: true, vectors: [[0, 1, 0]] } as never);
    const rerank = vi.spyOn(AIService, 'rerank').mockResolvedValue({ ok: false, error: 'x' } as never);

    const results = await searchNotes('поищи про Вику', 5);

    expect(results.map(r => r.documentId)).toContain(NOTE_ID);
    expect(rerank).not.toHaveBeenCalled();
  });
});
