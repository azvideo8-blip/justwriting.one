import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { getLocalDb } from '../../../../core/storage/localDb';
import { AIProfileService } from '../AIProfileService';
import { AIMonthlyDigestService } from '../AIMonthlyDigestService';
import { AIProfileRefreshService } from '../AIProfileRefreshService';
import { AIConsolidationService } from '../AIConsolidationService';
import { LocalDocumentService } from '../../../../core/services/LocalDocumentService';
import { AIService } from '../AIService';
import { AITimelineService } from '../AITimelineService';
import { writeFacetStore } from '../../../../core/services/facetLock';

vi.mock('../../../../shared/errors/reportError', () => ({ reportError: vi.fn() }));

describe('AG-PROF-1: Portrait Integrity & Service Guards', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.restoreAllMocks();
    const db = await getLocalDb();
    for (const store of [
      'documents',
      'versions',
      'aiSummaries',
      'aiProfileFacets',
      'aiPortrait',
      'aiMonthlyDigest',
      'aiTimeline',
      'aiDialogues',
      'aiBeliefs',
      'aiBeliefRejections',
    ] as const) {
      await db.clear(store);
    }
  });

  it('Requirement 1: AIProfileService.generate does NOT save degraded placeholder portrait on partial failure with empty cache', async () => {
    const db = await getLocalDb();

    // 3 summaries so inputs exist
    for (let i = 1; i <= 3; i++) {
      await db.put('aiSummaries', {
        documentId: `doc_${i}`,
        summary: `Тестовое саммари ${i}`,
        themes: ['работа'],
        keyPeople: [],
        extractedFacts: [],
        updatedAt: Date.now(),
      } as never);
    }

    // Mock AIService.chat to succeed on first section but fail on others
    let callCount = 0;
    vi.spyOn(AIService, 'chat').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, text: 'Успешный раздел тем' };
      }
      return { ok: false, error: 'RATE_LIMIT' };
    });

    const saveSpy = vi.spyOn(AIProfileService, 'savePortrait');

    const result = await AIProfileService.generate();
    expect(result.ok).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();

    const storedPortrait = await db.get('aiPortrait', 'singleton');
    expect(storedPortrait).toBeUndefined();
    expect(localStorage.getItem('ai_user_portrait')).toBeNull();

    // But successful section is kept in cache for fast retry
    const cachedSections = JSON.parse(localStorage.getItem('ai_portrait_sections_guest') || '{}');
    expect(cachedSections.themes?.content).toBe('Успешный раздел тем');
  });

  it('Requirement 2: AIMonthlyDigestService does not re-generate if a fresh (<24h) digest exists', async () => {
    const db = await getLocalDb();
    const month = '2026-08';

    await db.put('aiMonthlyDigest', {
      month,
      narrative: 'Существующий свежий дайджест',
      tones: ['спокойный'],
      themes: ['творчество'],
      noteCount: 5,
      generatedAt: Date.now() - 1000, // 1 second ago (< 24h)
    } as never);

    vi.spyOn(AITimelineService, 'getByMonth').mockResolvedValue([
      { date: '2026-08-01', month, summary: 'День 1', tone: 'спокойный', themes: ['творчество'] } as never,
      { date: '2026-08-02', month, summary: 'День 2', tone: 'спокойный', themes: ['творчество'] } as never,
    ]);

    const summarizeSpy = vi.spyOn(AIService, 'summarizeFacet');

    await AIMonthlyDigestService.generateForMonth(month);
    expect(summarizeSpy).not.toHaveBeenCalled();
  });

  it('Requirement 3: AIProfileRefreshService rejects concurrent executions with lock', async () => {
    let releaseFirst: () => void;
    const firstPromise = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    vi.spyOn(AIProfileService, 'generate').mockImplementation(async () => {
      await firstPromise;
      return { ok: true, markdown: 'Портрет' };
    });

    // Start first run
    const run1 = AIProfileRefreshService.run();
    expect(AIProfileRefreshService.isRunning()).toBe(true);

    // Second run should reject
    await expect(AIProfileRefreshService.run()).rejects.toThrow(/already in progress/i);

    // Clean up first run
    releaseFirst!();
    await run1;
    expect(AIProfileRefreshService.isRunning()).toBe(false);
  });

  it('Requirement 5: cascadeDeleteAIDerivatives cleans facets, beliefs, and invalidates portrait', async () => {
    const db = await getLocalDb();
    const docId = 'doc_cascade_test';

    // 1. Facet with docId and other note
    await writeFacetStore(s => s.put({
      id: 'f1',
      label: 'Творчество',
      centroid: [0.1, 0.2],
      noteIds: [docId, 'doc_keep'],
      dialogueIds: [],
      noteCount: 2,
      dirty: false,
      updatedAt: 1000,
    } as never));

    // 2. Belief with docId evidence
    await db.put('aiBeliefs', {
      id: 'b1',
      belief: 'Любит писать по утрам',
      evidence: [{ id: 'e1', date: '2026-08-01', noteId: docId }],
      firstSeenAt: '2026-08-01',
      clusterSize: 1,
      createdAt: 1000,
      updatedAt: 1000,
      judgeVerdict: 'PASSED',
      unitIds: ['u1'],
    } as never);

    // 3. Portrait
    await db.put('aiPortrait', {
      id: 'singleton',
      portrait: 'Старый портрет',
      updatedAt: 1000,
    } as never);
    localStorage.setItem('ai_user_portrait', 'Старый портрет');

    await LocalDocumentService.cascadeDeleteAIDerivatives(docId);

    // Facet should have docId removed and dirty: true
    const updatedFacet = await db.get('aiProfileFacets', 'f1');
    expect(updatedFacet?.noteIds).toEqual(['doc_keep']);
    expect(updatedFacet?.noteCount).toBe(1);
    expect(updatedFacet?.dirty).toBe(true);

    // Belief had only 1 evidence referencing docId -> should be deleted
    const updatedBelief = await db.get('aiBeliefs', 'b1');
    expect(updatedBelief).toBeUndefined();

    // Portrait should be invalidated
    const updatedPortrait = await db.get('aiPortrait', 'singleton');
    expect(updatedPortrait).toBeUndefined();
    expect(localStorage.getItem('ai_user_portrait')).toBeNull();
  });

  it('Requirement 6: AIConsolidationService.gatherMemoryUnits excludes units from aiBeliefRejections', async () => {
    const db = await getLocalDb();

    await db.put('aiChatMemory', {
      id: 'mem_rejected_1',
      dialogueId: 'd1',
      kind: 'fact',
      text: 'Отклонённая мысль',
      updatedAt: Date.now(),
    } as never);

    await db.put('aiChatMemory', {
      id: 'mem_fresh_2',
      dialogueId: 'd1',
      kind: 'fact',
      text: 'Свежая мысль',
      updatedAt: Date.now(),
    } as never);

    await db.put('aiBeliefRejections', {
      id: 'rej_1',
      timestamp: Date.now(),
      clusterSize: 1,
      firstSeenAt: '2026-08-01',
      reason: 'Слишком тривиально',
      kind: 'judge_rejected',
      rewriteAttempted: false,
      rejectedTextSnippet: 'Отклонённая мысль',
      unitIds: ['mem_rejected_1'],
    } as never);

    const units = await AIConsolidationService.gatherMemoryUnits();
    expect(units.some(u => u.id === 'mem_rejected_1')).toBe(false);
    expect(units.some(u => u.id === 'mem_fresh_2')).toBe(true);
  });
});
