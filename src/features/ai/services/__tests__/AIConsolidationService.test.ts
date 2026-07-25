import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIConsolidationService, MemoryClusterCandidate } from '../AIConsolidationService';
import { AIService } from '../AIService';
import { AIBackgroundBudget } from '../AIBackgroundBudget';
import { getLocalDb } from '../../../../core/storage/localDb';

vi.mock('../AIService', () => ({
  AIService: {
    summarizeBeliefCluster: vi.fn(),
    judgeBeliefCandidate: vi.fn(),
  },
}));

describe('AG-MIND-W3-consolidation — Episodic to Semantic Belief Consolidation', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    try {
      const db = await getLocalDb();
      if (db.objectStoreNames.contains('aiBeliefs')) {
        await db.clear('aiBeliefs');
      }
    } catch {
      /* ignore IDB reset error */
    }
  });

  it('Requirement 1: A cluster of related units produces a belief with earliest firstSeenAt and source evidence IDs', async () => {
    const cluster: MemoryClusterCandidate = {
      clusterId: 'cluster-test-1',
      earliestDate: '2026-05-10',
      salience: 0.85,
      units: [
        { id: 'unit-1', type: 'chat_memory', text: 'Пользователь начал бегать по утрам', date: '2026-05-10', salience: 0.8 },
        { id: 'unit-2', type: 'summary', text: 'Утренние пробежки приносят энергию', date: '2026-06-01', salience: 0.9 },
      ],
    };

    vi.mocked(AIService.summarizeBeliefCluster).mockResolvedValue({
      ok: true,
      belief: 'Пользователь регулярно делает утренние пробежки для поддержания энергии',
    });

    vi.mocked(AIService.judgeBeliefCandidate).mockResolvedValue({
      ok: true,
      passed: true,
      reason: 'Belief accurately reflects facts without distortion',
    });

    const { belief } = await AIConsolidationService.consolidateAndJudgeCluster(cluster);

    expect(belief).not.toBeNull();
    expect(belief?.firstSeenAt).toBe('2026-05-10');
    expect(belief?.clusterSize).toBe(2);
    expect(belief?.judgeVerdict).toBe('PASSED');
    expect(belief?.unitIds).toEqual(['unit-1', 'unit-2']);
    expect(belief?.evidence.map(e => e.id)).toEqual(['unit-1', 'unit-2']);
  });

  it('Requirement 2: Distortion test (C2 seed) — unqualified assertion of hedged fact ("X иногда, но Y") must fail judge', async () => {
    const cluster: MemoryClusterCandidate = {
      clusterId: 'cluster-hedged',
      earliestDate: '2026-04-01',
      salience: 0.75,
      units: [
        { id: 'u1', type: 'chat_memory', text: 'Я иногда занимаюсь медитацией, но при сильном стрессе она меня раздражает', date: '2026-04-01', salience: 0.7 },
      ],
    };

    // First LLM candidate distorts statement into unqualified assertion
    vi.mocked(AIService.summarizeBeliefCluster).mockResolvedValueOnce({
      ok: true,
      belief: 'Пользователь всегда использует медитацию для снятия любого стресса',
    });

    // Judge catches distortion and flags missing hedge
    vi.mocked(AIService.judgeBeliefCandidate).mockResolvedValueOnce({
      ok: true,
      passed: false,
      reason: 'Distortion: omitted critical hedge that meditation irritates during high stress.',
      correctiveHint: 'Сохрани условность: медитация помогает иногда, но раздражает при сильном стрессе.',
    });

    // Rewrite LLM call keeps the hedge
    vi.mocked(AIService.summarizeBeliefCluster).mockResolvedValueOnce({
      ok: true,
      belief: 'Пользователь иногда практикует медитацию, но при сильном стрессе она вызывет раздражение',
    });

    // Re-judge passes rewritten belief
    vi.mocked(AIService.judgeBeliefCandidate).mockResolvedValueOnce({
      ok: true,
      passed: true,
      reason: 'Hedge preserved accurately.',
    });

    const { belief } = await AIConsolidationService.consolidateAndJudgeCluster(cluster);

    expect(belief).not.toBeNull();
    expect(belief?.judgeVerdict).toBe('REWRITTEN_PASSED');
    expect(belief?.belief).toContain('раздражение');
  });

  it('Requirement 3: Fail-open test — when judge rejects and rewrite fails, belief is NOT published and 0 IDB writes occur', async () => {
    const cluster: MemoryClusterCandidate = {
      clusterId: 'cluster-fail-open',
      earliestDate: '2026-03-15',
      salience: 0.9,
      units: [
        { id: 'u1', type: 'chat_memory', text: 'Занимался бегом пару раз', date: '2026-03-15', salience: 0.9 },
      ],
    };

    vi.mocked(AIService.summarizeBeliefCluster).mockResolvedValue({
      ok: true,
      belief: 'Пользователь являтся профессиональным марафонцем',
    });

    // Judge rejects initial and rewritten attempt
    vi.mocked(AIService.judgeBeliefCandidate).mockResolvedValue({
      ok: true,
      passed: false,
      reason: 'Severe hallucination.',
      correctiveHint: 'Пользователь пробежал только пару раз.',
    });

    const { belief: result } = await AIConsolidationService.consolidateAndJudgeCluster(cluster);

    // Fail-open guarantee: unverified generalization is NEVER published
    expect(result).toBeNull();

    const publishedBeliefs = await AIConsolidationService.getAllBeliefs();
    expect(publishedBeliefs.length).toBe(0);
  });

  it('Requirement 4: Idempotency — already consolidated units are filtered out from future passes', async () => {
    const db = await getLocalDb();
    await db.put('aiBeliefs', {
      id: 'belief-existing-1',
      belief: 'Existing belief',
      evidence: [],
      firstSeenAt: '2026-01-01',
      clusterSize: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      judgeVerdict: 'PASSED',
      unitIds: ['unit-already-done'],
    } as unknown as Record<string, unknown>);

    await db.put('aiChatMemory', {
      id: 'unit-already-done',
      kind: 'fact',
      text: 'Existing chat memory text',
      sourceDialogueId: 'dlg-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await db.put('aiChatMemory', {
      id: 'unit-new-item',
      kind: 'insight',
      text: 'New fresh chat memory',
      sourceDialogueId: 'dlg-2',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const gathered = await AIConsolidationService.gatherMemoryUnits();
    expect(gathered.find(u => u.id === 'unit-already-done')).toBeUndefined();
    expect(gathered.find(u => u.id === 'unit-new-item')).toBeDefined();
  });

  it('Requirement 5: Governor test — stops cleanly when AIBackgroundBudget is exhausted', async () => {
    // Fill background budget
    AIBackgroundBudget.spend(60);

    const processed = await AIConsolidationService.processConsolidationPass();
    expect(processed).toBe(0);
    expect(AIService.summarizeBeliefCluster).not.toHaveBeenCalled();
  });

  it('Governor: a failing provider must not be charged to the shared daily budget', async () => {
    // The summarize callable is unavailable / upstream is down: no LLM work happens.
    vi.mocked(AIService.summarizeBeliefCluster).mockResolvedValue({ ok: false, error: 'NOT_FOUND' });

    const cluster: MemoryClusterCandidate = {
      clusterId: 'c-budget',
      earliestDate: '2026-05-10',
      salience: 0.9,
      units: [
        { id: 'u-1', type: 'chat_memory', text: 'работа выматывает', date: '2026-05-10', salience: 0.9 },
        { id: 'u-2', type: 'chat_memory', text: 'работа выматывает сильно', date: '2026-06-01', salience: 0.8 },
      ],
    };

    const { belief, llmCalls } = await AIConsolidationService.consolidateAndJudgeCluster(cluster);

    expect(belief).toBeNull();
    // Charging up-front meant a dead callable drained all 60 units/day and starved
    // threads, digests, portrait and facet work that share the same budget.
    expect(llmCalls).toBe(0);
  });

  it('Requirement 6: Non-destructive IDB v18 upgrade preserves all data', async () => {
    const db = await getLocalDb();
    expect(db.objectStoreNames.contains('aiBeliefs')).toBe(true);
    expect(db.objectStoreNames.contains('aiInjectionJournal')).toBe(true);
    expect(db.objectStoreNames.contains('aiThemeLedger')).toBe(true);
    expect(db.objectStoreNames.contains('documents')).toBe(true);
  });
});
