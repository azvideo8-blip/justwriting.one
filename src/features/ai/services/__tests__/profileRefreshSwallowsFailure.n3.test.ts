import { beforeEach, describe, expect, it, vi } from 'vitest';

const generate = vi.hoisted(() => vi.fn());
vi.mock('@/features/ai/services/AIProfileService', () => ({ AIProfileService: { generate } }));
const steps = vi.hoisted(() => ({
  resummarizeDirty: vi.fn(), summarizePending: vi.fn(), review: vi.fn(), generateForMonth: vi.fn(),
}));
vi.mock('@/features/ai/services/AIProfileFacetService', () => ({
  AIProfileFacetService: { resummarizeDirty: steps.resummarizeDirty, summarizePending: steps.summarizePending },
}));
vi.mock('@/features/ai/services/AIFacetJudgeService', () => ({ AIFacetJudgeService: { review: steps.review } }));
vi.mock('@/features/ai/services/AIMonthlyDigestService', () => ({ AIMonthlyDigestService: { generateForMonth: steps.generateForMonth } }));
vi.mock('@/features/ai/services/AIBackgroundBudget', () => ({ withUserRun: async <T>(fn: () => Promise<T>) => fn() }));
vi.mock('@/core/storage/localDb', () => ({ getLocalDb: async () => ({ getAll: async () => [{ month: '2026-11' }] }) }));
vi.mock('@/shared/errors/reportError', () => ({ reportError: vi.fn() }));

import { AIProfileRefreshService } from '@/features/ai/services/AIProfileRefreshService';

beforeEach(() => {
  vi.clearAllMocks();
  steps.resummarizeDirty.mockResolvedValue({ count: 0, failed: 0 });
  steps.summarizePending.mockResolvedValue({ done: 0, failed: 0 });
  steps.review.mockResolvedValue({ judged: 0, corrected: 0, unchecked: 0, log: [] });
  steps.generateForMonth.mockResolvedValue(true);
});

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
    generate.mockResolvedValue({ ok: true, markdown: 'MARKER_DAILY_PORTRAIT', partial: false, saved: true });
    const { failed } = await AIProfileRefreshService.run();
    expect(failed).toEqual([]);
  });
});

// 0.11.22: темы, проверка тем и сводки месяца отказывали возвратом (а не броском),
// и «Профиль обновлён» шёл при отказе поставщика. Мутации: убрать throw в шаге
// facets / judge / digests в AIProfileRefreshService — красный соответствующий тест.
describe('run(): недоделанный шаг назван, а не «обновлён»', () => {
  beforeEach(() => { generate.mockResolvedValue({ ok: true, markdown: 'x', partial: false, saved: true }); });
  it('темы: грань осталась несвежей — facets в failed', async () => {
    steps.resummarizeDirty.mockResolvedValue({ count: 1, failed: 2 });
    expect((await AIProfileRefreshService.run()).failed).toContain('facets');
  });
  it('проверка тем: часть не проверена — judge в failed', async () => {
    steps.review.mockResolvedValue({ judged: 2, corrected: 0, unchecked: 3, log: [] });
    expect((await AIProfileRefreshService.run()).failed).toContain('judge');
  });
  it('сводка месяца не собрана — digests в failed', async () => {
    steps.generateForMonth.mockResolvedValue(false);
    expect((await AIProfileRefreshService.run()).failed).toContain('digests');
  });
});

// 0.11.22: портрет собран частично (разделы из прошлой сборки или заглушка) —
// раньше ok:true и «Профиль обновлён». Мутация: убрать throw на res.partial — красный.
describe('run(): частичный портрет назван', () => {
  it('generate вернул partial — portrait в failed', async () => {
    generate.mockResolvedValue({ ok: true, markdown: 'x', partial: true, saved: true });
    expect((await AIProfileRefreshService.run()).failed).toContain('portrait');
  });

  // Ревью 0.11.25 N-1: главный вход («Обновить профиль»). Мутация: убрать throw на saved — красный.
  it('портрет собран, но не сохранился — portrait в failed', async () => {
    generate.mockResolvedValue({ ok: true, markdown: 'x', partial: false, saved: false });
    expect((await AIProfileRefreshService.run()).failed).toContain('portrait');
  });
});

