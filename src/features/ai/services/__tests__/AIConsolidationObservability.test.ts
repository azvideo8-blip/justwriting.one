import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLocalDb, clearAllLocalStores } from '../../../../core/storage/localDb';
import { AIConsolidationService, type MemoryClusterCandidate } from '../AIConsolidationService';
import { AIService } from '../AIService';

// The ring-buffer test writes 200+ records one at a time, and saveRejection
// re-scans the store on every write, so this suite is legitimately slow. Under
// the 5s default it times out whenever another heavy suite competes for CPU —
// and a half-finished run leaks records into the next test, which then fails
// for a reason that has nothing to do with it.
describe('AG-MIND-W3-obs AIConsolidationService Observability', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await clearAllLocalStores();
    vi.clearAllMocks();
  });

  const mockCluster: MemoryClusterCandidate = {
    clusterId: 'cluster-2026-07-01-0',
    earliestDate: '2026-07-01',
    salience: 0.8,
    units: [
      { id: 'u1', type: 'chat_memory', text: 'Пользователь любит утренний кофе.', date: '2026-07-01', salience: 0.8 },
      { id: 'u2', type: 'chat_memory', text: 'Кофе по утрам дает энергию.', date: '2026-07-02', salience: 0.8 },
    ],
  };

  it('records rejections in aiBeliefRejections store and keeps them out of aiBeliefs', async () => {
    // Mock initial summarization success
    vi.spyOn(AIService, 'summarizeBeliefCluster').mockResolvedValue({
      ok: true,
      belief: 'Пользователь всегда пьет кофе и он никогда не устает.',
    });

    // Mock initial judge rejection and rewrite recheck rejection
    vi.spyOn(AIService, 'judgeBeliefCandidate').mockResolvedValue({
      ok: true,
      passed: false,
      reason: 'Ложное обобщение: в фактах нет слова всегда.',
      correctiveHint: 'Сохрани условность.',
    });

    const res = await AIConsolidationService.consolidateAndJudgeCluster(mockCluster);

    // Fail-open guarantee: candidate is NOT published
    expect(res.belief).toBeNull();

    // Verify aiBeliefs store is empty
    const publishedBeliefs = await AIConsolidationService.getAllBeliefs();
    expect(publishedBeliefs).toHaveLength(0);

    // Verify rejection is logged in aiBeliefRejections store
    const rejections = await AIConsolidationService.getAllRejections();
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.rejectedTextSnippet).toContain('Пользователь всегда пьет кофе');
    expect(rejections[0]?.reason).toContain('Ложное обобщение');
    expect(rejections[0]?.rewriteAttempted).toBe(true);
    expect(rejections[0]?.unitIds).toEqual(['u1', 'u2']);
  });

  it('correctly sets rewriteAttempted=true when initial judge fails and rewrite is triggered', async () => {
    vi.spyOn(AIService, 'summarizeBeliefCluster')
      .mockResolvedValueOnce({
        ok: true,
        belief: 'Искаженный фасет.',
      })
      .mockResolvedValueOnce({
        ok: false,
        error: 'Upstream error',
      });

    // Initial judge fails without passed, return passed=false
    vi.spyOn(AIService, 'judgeBeliefCandidate').mockResolvedValueOnce({
      ok: true,
      passed: false,
      reason: 'Критическое искажение.',
    });

    const res = await AIConsolidationService.consolidateAndJudgeCluster(mockCluster);
    expect(res.belief).toBeNull();

    const rejections = await AIConsolidationService.getAllRejections();
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.rewriteAttempted).toBe(true);
    expect(rejections[0]?.reason).toBe('Критическое искажение.');
  });

  it('distinguishes a judge verdict from a failure to get one (reject-rate honesty)', async () => {
    vi.spyOn(AIService, 'summarizeBeliefCluster').mockResolvedValue({
      ok: true,
      belief: 'Пользователь всегда пьёт кофе по утрам.',
    });

    // The judge CALL fails — we never got a verdict. Nothing may be published
    // (fail-open holds), but this must not be counted as the judge rejecting:
    // otherwise a flaky provider reads as "the judge is too strict" and we would
    // loosen a judge that is working fine.
    vi.spyOn(AIService, 'judgeBeliefCandidate').mockResolvedValue({ ok: false, error: 'SERVER_ERROR' });

    const { belief } = await AIConsolidationService.consolidateAndJudgeCluster(mockCluster);
    expect(belief).toBeNull();

    const rejections = await AIConsolidationService.getAllRejections();
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.kind).toBe('evaluation_failed');

    // And a real verdict is tagged as such.
    await AIConsolidationService.clearRejections();
    vi.spyOn(AIService, 'judgeBeliefCandidate').mockResolvedValue({
      ok: true,
      passed: false,
      reason: 'Переобобщение: "всегда" не следует из фактов',
    });
    // First summarize succeeds so the judge is reached; the rewrite then fails,
    // leaving a genuine judge verdict as the reason nothing was published.
    vi.spyOn(AIService, 'summarizeBeliefCluster')
      .mockResolvedValueOnce({ ok: true, belief: 'Пользователь всегда пьёт кофе по утрам.' })
      .mockResolvedValue({ ok: false, error: 'SERVER_ERROR' });

    await AIConsolidationService.consolidateAndJudgeCluster(mockCluster);
    const afterJudge = await AIConsolidationService.getAllRejections();
    expect(afterJudge[0]?.kind).toBe('judge_rejected');
  });

  it('caps rejections log at 200 items in ring buffer', async () => {
    for (let i = 0; i < 210; i++) {
      await AIConsolidationService.saveRejection({
        id: `rej-${i}`,
        timestamp: Date.now() + i,
        clusterSize: 2,
        firstSeenAt: '2026-07-01',
        reason: `Rejection reason ${i}`,
        kind: 'judge_rejected' as const,
      rewriteAttempted: false,
        rejectedTextSnippet: `Snippet ${i}`,
        unitIds: ['u1', 'u2'],
      });
    }

    const rejections = await AIConsolidationService.getAllRejections(300);
    expect(rejections.length).toBe(200);

    // Oldest 10 records (0 to 9) evicted; newest (209) present
    expect(rejections[0]?.id).toBe('rej-209');
  });

  it('clears all rejections on clearAllLocalStores or clearRejections', async () => {
    await AIConsolidationService.saveRejection({
      id: 'rej-test',
      timestamp: Date.now(),
      clusterSize: 2,
      firstSeenAt: '2026-07-01',
      reason: 'Test rejection',
      kind: 'judge_rejected' as const,
      rewriteAttempted: false,
      rejectedTextSnippet: 'Snippet',
      unitIds: ['u1'],
    });

    let rejections = await AIConsolidationService.getAllRejections();
    expect(rejections).toHaveLength(1);

    await AIConsolidationService.clearRejections();
    rejections = await AIConsolidationService.getAllRejections();
    expect(rejections).toHaveLength(0);

    await AIConsolidationService.saveRejection({
      id: 'rej-test-2',
      timestamp: Date.now(),
      clusterSize: 2,
      firstSeenAt: '2026-07-01',
      reason: 'Test rejection 2',
      kind: 'judge_rejected' as const,
      rewriteAttempted: false,
      rejectedTextSnippet: 'Snippet 2',
      unitIds: ['u1'],
    });

    await clearAllLocalStores();
    const db = await getLocalDb();
    const storeRecords = await db.getAll('aiBeliefRejections');
    expect(storeRecords).toHaveLength(0);
  });
});
