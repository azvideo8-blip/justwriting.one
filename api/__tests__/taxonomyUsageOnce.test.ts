import { describe, it, expect, vi } from 'vitest';
import { deriveTaxonomyLogic } from '../ai/deriveTaxonomy.logic';
import { generate } from '../ai/provider';
import type { AiContext } from '../../src/shared/ai/context.js';

vi.mock('../ai/provider', () => ({ generate: vi.fn() }));

// DA-18: ответ модели не разобрался — расход записывался дважды: settle('failed')
// сводил его по оценке, а finally писал ещё раз напрямую мимо защёлки.
describe('deriveTaxonomy records usage once when the answer cannot be parsed', () => {
  it('one usage row, with the real token counts', async () => {
    vi.mocked(generate).mockResolvedValue({ text: 'совсем не JSON', tokensIn: 700, tokensOut: 90, model: 'm' });
    const recordUsage = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      checkAndIncrementBulkLimit: vi.fn().mockResolvedValue({ ok: true, day: '2026-09-24' }),
      refundBulkLimit: vi.fn().mockResolvedValue(undefined),
      tryReserveGlobalRequest: vi.fn().mockResolvedValue({ date: '2026-09-24', shardId: '0', allowance: 9000 }),
      refundGlobalRequest: vi.fn().mockResolvedValue(undefined),
      recordUsage,
    } as unknown as AiContext;

    await expect(deriveTaxonomyLogic(ctx, 'u1', { digest: 'Дайджест дневника для проверки учёта.' })).rejects.toThrow();
    await new Promise(r => setTimeout(r, 0));
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage.mock.calls[0]![1]).toBe(700);
  });
});
