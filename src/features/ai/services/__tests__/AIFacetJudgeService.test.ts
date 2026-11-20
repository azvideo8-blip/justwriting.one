import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEvidence, type SummaryRow, AIFacetJudgeService } from '../AIFacetJudgeService';
import { AIProfileFacetService } from '../AIProfileFacetService';
import { AIEmbeddingService } from '../AIEmbeddingService';

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
      { id: 'f1', label: 'Доверие', summary: 'коллега Анна', noteIds: ['n1'] },
    ]),
  },
  withFacetLock: vi.fn(<T,>(fn: () => Promise<T>) => fn()),
}));
vi.mock('../../../../core/storage/localDb', () => ({
  getLocalDb: vi.fn(async () => ({
    getAll: vi.fn(async (store: string) =>
      store === 'aiSummaries'
        ? [{ documentId: 'n1', themes: ['доверие'], insights: [] }]
        : [],
    ),
    put: putMock,
  })),
}));
vi.mock('../AIEmbeddingService', () => ({
  AIEmbeddingService: { getAll: vi.fn(async () => [{ documentId: 'n1', chunkTexts: ['текст заметки один'] }]) },
}));

const rows: SummaryRow[] = [
  { documentId: 'n1', themes: ['отвержение', 'доверие'], insights: ['боится просить'] },
  { documentId: 'n2', themes: ['отвержение'], insights: [] },
  { documentId: 'n3', themes: ['деньги'], insights: [] },
];

describe('buildEvidence', () => {
  it('covers the facet notes only', () => {
    const ev = buildEvidence(['n1', 'n2'], rows);
    expect(ev).toContain('отвержение');
    expect(ev).not.toContain('деньги'); // n3 excluded
  });

  // D4.17: судья читает доказательства вслух модели — имён среди них быть не
  // должно ни при каких входных данных, включая старые записи с полем.
  it('never puts names into the evidence sent to the provider', () => {
    const legacy = [{ documentId: 'n9', themes: ['семья'], insights: [], mentionedPeople: [{ name: 'Анна', role: 'терапевт' }] }];
    const ev = buildEvidence(['n9'], legacy as never);
    expect(ev).not.toContain('Анна');
    expect(ev).not.toContain('терапевт');
  });

  it('includes top themes by frequency', () => {
    const ev = buildEvidence(['n1', 'n2'], rows);
    expect(ev).toContain('отвержение');
  });

  it('returns a non-empty string for a bare note', () => {
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
      .mockResolvedValueOnce({ ok: true, verdicts: [{ facetId: 'f1', ok: false, issues: ['роль'], hint: 'Анна — терапевт' }] })
      .mockResolvedValueOnce({ ok: true, verdicts: [{ facetId: 'f1', ok: true, issues: [], hint: '' }] });
    summarizeMock.mockResolvedValue({ ok: true, label: 'Доверие', summary: 'терапевт Анна' });

    const res = await AIFacetJudgeService.review();
    expect(summarizeMock).toHaveBeenCalledWith(expect.objectContaining({ correction: 'Анна — терапевт' }));
    expect(putMock).toHaveBeenCalledWith('aiProfileFacets', expect.objectContaining({ summary: 'терапевт Анна' }));
    expect(res.corrected).toBe(1);
  });

  it('writes nothing when all facets pass', async () => {
    judgeMock.mockResolvedValue({ ok: true, verdicts: [{ facetId: 'f1', ok: true, issues: [], hint: '' }] });
    const res = await AIFacetJudgeService.review();
    expect(summarizeMock).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(res.corrected).toBe(0);
  });

  it('stops chunk iteration when judgeFacets returns NETWORK (not one call per chunk)', async () => {
    // CHUNK_MAX = 3, so 4 facets produce 2 chunks. If the loop doesn't stop,
    // judgeFacets is called twice — once per chunk.
    const facets = Array.from({ length: 4 }, (_, i) => ({
      id: `f${i + 1}`, label: `facet${i + 1}`, summary: 's', noteIds: ['n1'],
    }));
    vi.mocked(AIProfileFacetService.getAll).mockResolvedValue(facets as Awaited<ReturnType<typeof AIProfileFacetService.getAll>>);

    judgeMock
      .mockResolvedValueOnce({ ok: false, error: 'NETWORK' })
      .mockResolvedValueOnce({ ok: true, verdicts: [] });

    const res = await AIFacetJudgeService.review();
    // The loop must stop after the first failure — one call, not two.
    expect(judgeMock).toHaveBeenCalledTimes(1);
    expect(res.judged).toBe(0);
    // 0.11.22: не дошли — названо (иначе «Профиль обновлён»). Мутация:
    // unchecked = 0 — красный.
    expect(res.unchecked).toBe(4);
  });

  // TR-9: при пересказе грани по замечанию судьи модели уходят фрагменты заметок.
  // Фрагменты неразобранной заметки (вектор остался с прежних версий) не уходят.
  // Мутация: убрать `|| !analysedIds.has(e.documentId)` → красный.
  it('TR-9: фрагменты неразобранной заметки не уходят в пересказ грани', async () => {
    vi.mocked(AIProfileFacetService.getAll).mockResolvedValue([
      { id: 'f1', label: 'Доверие', summary: 'коллега Анна', noteIds: ['n1', 'nRaw'] },
    ] as Awaited<ReturnType<typeof AIProfileFacetService.getAll>>);
    vi.mocked(AIEmbeddingService.getAll).mockResolvedValue([
      { documentId: 'n1', chunkTexts: ['текст заметки один'] },
      { documentId: 'nRaw', chunkTexts: ['ФРАГМЕНТ_НЕРАЗОБРАННОЙ'] },
    ] as Awaited<ReturnType<typeof AIEmbeddingService.getAll>>);
    judgeMock
      .mockResolvedValueOnce({ ok: true, verdicts: [{ facetId: 'f1', ok: false, issues: ['роль'], hint: 'Анна — терапевт' }] })
      .mockResolvedValueOnce({ ok: true, verdicts: [{ facetId: 'f1', ok: true, issues: [], hint: '' }] });
    summarizeMock.mockResolvedValue({ ok: true, label: 'Доверие', summary: 'терапевт Анна' });

    await AIFacetJudgeService.review();
    const sent = JSON.stringify(summarizeMock.mock.calls);
    expect(sent).toContain('текст заметки один');
    expect(sent).not.toContain('ФРАГМЕНТ_НЕРАЗОБРАННОЙ');
  });
});

