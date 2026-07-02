import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEvidence, type SummaryRow, AIFacetJudgeService } from '../AIFacetJudgeService';

const judgeMock = vi.fn();
const summarizeMock = vi.fn();
vi.mock('../AIService', () => ({
  AIService: {
    judgeFacets: (...a: unknown[]) => judgeMock(...a),
    summarizeFacet: (...a: unknown[]) => summarizeMock(...a),
  },
}));

const putMock = vi.fn();
vi.mock('../AIProfileFacetService', () => ({
  AIProfileFacetService: {
    getAll: vi.fn(async () => [
      { id: 'f1', label: 'Доверие', summary: 'коллега Имя1', noteIds: ['n1'] },
    ]),
  },
  withFacetLock: vi.fn(<T,>(fn: () => Promise<T>) => fn()),
}));
vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    getAll: vi.fn(async (store: string) =>
      store === 'aiSummaries'
        ? [{ documentId: 'n1', themes: ['доверие'], insights: [], mentionedPeople: [{ name: 'Имя1', role: 'терапевт' }] }]
        : [],
    ),
    put: putMock,
  })),
}));
vi.mock('../AIEmbeddingService', () => ({
  AIEmbeddingService: { getAll: vi.fn(async () => [{ documentId: 'n1', chunkTexts: ['текст заметки один'] }]) },
}));

const rows: SummaryRow[] = [
  { documentId: 'n1', themes: ['отвержение', 'доверие'], insights: ['боится просить'], mentionedPeople: [{ name: 'Имя1', role: 'терапевт' }] },
  { documentId: 'n2', themes: ['отвержение'], insights: [], mentionedPeople: [{ name: 'Имя1', role: 'терапевт' }, { name: 'Имя2', role: 'знакомая' }] },
  { documentId: 'n3', themes: ['деньги'], insights: [], mentionedPeople: [] },
];

describe('buildEvidence', () => {
  it('aggregates dedup people-roles for the facet notes only', () => {
    const ev = buildEvidence(['n1', 'n2'], rows);
    expect(ev).toContain('Имя1 — терапевт');
    expect(ev).toContain('Имя2 — знакомая');
    expect(ev).not.toContain('деньги'); // n3 excluded
  });

  it('includes top themes by frequency', () => {
    const ev = buildEvidence(['n1', 'n2'], rows);
    expect(ev).toContain('отвержение');
  });

  it('returns a non-empty string even with no people', () => {
    const ev = buildEvidence(['n3'], rows);
    expect(ev).toContain('деньги');
    expect(typeof ev).toBe('string');
  });
});

describe('AIFacetJudgeService.review', () => {
  beforeEach(() => {
    judgeMock.mockReset();
    summarizeMock.mockReset();
    putMock.mockReset();
  });

  it('re-summarizes a flagged facet with the hint and stores the corrected summary', async () => {
    judgeMock
      .mockResolvedValueOnce({ ok: true, verdicts: [{ facetId: 'f1', ok: false, issues: ['роль'], hint: 'Имя1 — терапевт' }] })
      .mockResolvedValueOnce({ ok: true, verdicts: [{ facetId: 'f1', ok: true, issues: [], hint: '' }] });
    summarizeMock.mockResolvedValue({ ok: true, label: 'Доверие', summary: 'терапевт Имя1' });

    const res = await AIFacetJudgeService.review();
    expect(summarizeMock).toHaveBeenCalledWith(expect.objectContaining({ correction: 'Имя1 — терапевт' }));
    expect(putMock).toHaveBeenCalledWith('aiProfileFacets', expect.objectContaining({ summary: 'терапевт Имя1' }));
    expect(res.corrected).toBe(1);
  });

  it('writes nothing when all facets pass', async () => {
    judgeMock.mockResolvedValue({ ok: true, verdicts: [{ facetId: 'f1', ok: true, issues: [], hint: '' }] });
    const res = await AIFacetJudgeService.review();
    expect(summarizeMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(res.corrected).toBe(0);
  });
});
