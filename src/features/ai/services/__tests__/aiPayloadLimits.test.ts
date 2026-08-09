import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallAi, mockReportError } = vi.hoisted(() => ({
  mockCallAi: vi.fn(),
  mockReportError: vi.fn(),
}));

vi.mock('../../../../core/ai/callAi', () => ({
  callAi: mockCallAi,
}));
vi.mock('../../../../core/auth', () => ({ getCurrentUser: () => ({ uid: 'u1' }) }));
vi.mock('../../../../shared/errors/reportError', () => ({ reportError: mockReportError }));

import { AIService } from '../AIService';

describe('rerank stays inside the endpoint contract', () => {
  beforeEach(() => {
    mockCallAi.mockReset();
    mockCallAi.mockResolvedValue({ documentIds: [] });
  });

  it('clamps an over-long query', async () => {
    await AIService.rerank({ query: 'я'.repeat(5_000), candidates: [] });
    const sent = mockCallAi.mock.calls[0]![1] as { query: string };
    expect(sent.query.length).toBe(2_000);
  });

  it('clamps an over-long card', async () => {
    await AIService.rerank({
      query: 'про Настю',
      candidates: [{ documentId: 'local_a', card: 'к'.repeat(9_000) }],
    });
    const sent = mockCallAi.mock.calls[0]![1] as { candidates: { card: string }[] };
    expect(sent.candidates[0]!.card.length).toBe(4_000);
  });

  it('leaves a payload that already fits untouched', async () => {
    await AIService.rerank({
      query: 'про Настю',
      candidates: [{ documentId: 'local_a', card: 'короткая карточка' }],
    });
    const sent = mockCallAi.mock.calls[0]![1] as { query: string; candidates: { card: string }[] };
    expect(sent.query).toBe('про Настю');
    expect(sent.candidates[0]!.card).toBe('короткая карточка');
  });
});
