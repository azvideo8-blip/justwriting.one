import { describe, it, expect, vi, beforeEach } from 'vitest';

const callable = vi.fn();
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => callable,
}));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'u1' } }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AIService } from '../AIService';

// rerankNotes rejects the whole call with "Invalid payload" when the query is
// over 2 000 characters or a card over 4 000. Both grow on their own in normal
// use — a sticky search appends the previous query, and a card carries a full
// summary plus an excerpt — so the search kept losing its reranking.
describe('rerank stays inside the endpoint contract', () => {
  beforeEach(() => {
    callable.mockReset();
    callable.mockResolvedValue({ data: { documentIds: [] } });
  });

  it('clamps an over-long query', async () => {
    await AIService.rerank({ query: 'я'.repeat(5_000), candidates: [] });

    const sent = callable.mock.calls[0]![0] as { query: string };
    expect(sent.query.length).toBe(2_000);
  });

  it('clamps an over-long card', async () => {
    await AIService.rerank({
      query: 'про Вику',
      candidates: [{ documentId: 'local_a', card: 'к'.repeat(9_000) }],
    });

    const sent = callable.mock.calls[0]![0] as { candidates: { card: string }[] };
    expect(sent.candidates[0]!.card.length).toBe(4_000);
  });

  it('leaves a payload that already fits untouched', async () => {
    await AIService.rerank({
      query: 'про Вику',
      candidates: [{ documentId: 'local_a', card: 'короткая карточка' }],
    });

    const sent = callable.mock.calls[0]![0] as { query: string; candidates: { card: string }[] };
    expect(sent.query).toBe('про Вику');
    expect(sent.candidates[0]!.card).toBe('короткая карточка');
  });
});
