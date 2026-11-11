import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { AIProfileRefreshService } from '../AIProfileRefreshService';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

// MB-11 (N-6): портрет — до пяти служебных вызовов из пула internal_chat (см.
// api/__tests__/portraitPool.mb11.test.ts). Оценка считала один и вычитала его из
// дневного лимита чата.
describe('MB-11: оценка «Обновить профиль»', () => {
  it('портрет — 5 вызовов, и они не входят в списание с лимита человека', async () => {
    const e = await AIProfileRefreshService.estimate();
    expect(e.steps.find(s => s.key === 'portrait')?.calls).toBe(5);
    expect(e.limitCalls).toBe(e.totalCalls - 5);
  });
});
