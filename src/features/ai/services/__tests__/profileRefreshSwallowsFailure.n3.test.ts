import { beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@/features/ai/services/AIProfileService', () => ({ AIProfileService: { generate } }));
vi.mock('@/features/ai/services/AIProfileFacetService', () => ({
  AIProfileFacetService: { resummarizeDirty: async () => {}, summarizePending: async () => {} },
}));
vi.mock('@/features/ai/services/AIFacetJudgeService', () => ({ AIFacetJudgeService: { review: async () => {} } }));
vi.mock('@/features/ai/services/AIMonthlyDigestService', () => ({ AIMonthlyDigestService: { generateForMonth: async () => {} } }));
vi.mock('@/features/ai/services/AIBackgroundBudget', () => ({ withUserRun: async <T>(fn: () => Promise<T>) => fn() }));
vi.mock('@/core/storage/localDb', () => ({ getLocalDb: async () => ({ getAll: async () => [] }) }));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AIProfileRefreshService } from '@/features/ai/services/AIProfileRefreshService';

beforeEach(() => { vi.clearAllMocks(); });

describe('run(): отказ портрета без throw обязан попасть в failed', () => {
  it('generate вернул { ok:false } — шаг portrait назван неудавшимся', async () => {
    generate.mockResolvedValue({ ok: false, error: 'partial_generation_failed' });
    const { failed } = await AIProfileRefreshService.run();
    expect(failed, 'ok:false проглочен: кнопка покажет «Профиль обновлён»').toContain('portrait');
  });
  it('КОНТРОЛЬ: generate бросил — шаг portrait в failed (путь catch работает)', async () => {
    generate.mockRejectedValue(new Error('provider down'));
    const { failed } = await AIProfileRefreshService.run();
    expect(failed).toContain('portrait');
  });
  it('КОНТРОЛЬ: generate вернул { ok:true } — failed пуст', async () => {
    generate.mockResolvedValue({ ok: true, markdown: 'MARKER_DAILY_PORTRAIT' });
    const { failed } = await AIProfileRefreshService.run();
    expect(failed).toEqual([]);
  });
});
