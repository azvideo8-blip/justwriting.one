import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllLocalStores } from '../../../../core/storage/localDb';
import { AIMemoryAssembler } from '../AIMemoryAssembler';
import { AIConsolidationService, type AIBelief } from '../AIConsolidationService';
import { MemoryFlagsService } from '../memoryFlags';
import { extractFirstSeenDates, sanitizeFirstSeenDates } from '../../utils/dateGuard';

describe('AG-MIND-W3-readpath AIMemoryAssembler Beliefs Integration', () => {
  beforeEach(async () => {
    await clearAllLocalStores();
    MemoryFlagsService.resetFlags();
    vi.clearAllMocks();
  });

  const mockBeliefPassed: AIBelief = {
    id: 'belief-1',
    belief: 'Пользователь отдает преимущество утреннему кодированию.',
    evidence: [
      { id: 'u1', date: '2026-07-01', snippet: 'Пишу код в 7 утра.' },
      { id: 'u2', date: '2026-07-05', snippet: 'Утренний код идет быстрее.' },
    ],
    firstSeenAt: '2026-07-01',
    clusterSize: 12,
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
    judgeVerdict: 'PASSED',
    unitIds: ['u1', 'u2'],
    isArchived: false,
  };

  const mockBeliefRejected: AIBelief = {
    id: 'belief-rejected',
    belief: 'Искажение: пользователь ненавидит программирование.',
    evidence: [{ id: 'u3', date: '2026-07-02', snippet: 'Устал от багов.' }],
    firstSeenAt: '2026-07-02',
    clusterSize: 1,
    createdAt: Date.now() - 500,
    updatedAt: Date.now() - 500,
    judgeVerdict: 'REJECTED',
    unitIds: ['u3'],
    isArchived: false,
  };

  const mockBeliefArchived: AIBelief = {
    id: 'belief-archived',
    belief: 'Устаревшее убеждение.',
    evidence: [{ id: 'u4', date: '2025-01-01', snippet: 'Старая мысль.' }],
    firstSeenAt: '2025-01-01',
    clusterSize: 2,
    createdAt: Date.now() - 2000,
    updatedAt: Date.now() - 2000,
    judgeVerdict: 'PASSED',
    unitIds: ['u4'],
    isArchived: true,
  };

  it('Requirement 5: Flag default false — output is byte-identical (land dark regression test)', async () => {
    await AIConsolidationService.saveBelief(mockBeliefPassed);

    const baselineWithoutBeliefs = await AIMemoryAssembler.assembleMemoryContext({
      userPortrait: 'Тестовый портрет',
    });

    // Ensure ff_memory_assembler_beliefs is false by default
    const flags = MemoryFlagsService.getFlags();
    expect(flags.ff_memory_assembler_beliefs).toBe(false);

    const resultWithBeliefsInDb = await AIMemoryAssembler.assembleMemoryContext({
      userPortrait: 'Тестовый портрет',
    });

    expect(resultWithBeliefsInDb).toBe(baselineWithoutBeliefs);
    if (typeof resultWithBeliefsInDb === 'string') {
      expect(resultWithBeliefsInDb).not.toContain('Убеждение');
    }
  });

  it('Requirement 1 & 2: With flag on & shadow off, published belief reaches context with [#id] evidence', async () => {
    await AIConsolidationService.saveBelief(mockBeliefPassed);
    await AIConsolidationService.saveBelief(mockBeliefRejected);
    await AIConsolidationService.saveBelief(mockBeliefArchived);

    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    MemoryFlagsService.setFlag('ff_memory_assembler_beliefs', true);

    const context = await AIMemoryAssembler.assembleMemoryContext({
      userPortrait: 'Тестовый портрет',
    });

    expect(context).not.toBeNull();
    expect(context).toContain('[Убеждение] «Пользователь отдает преимущество утреннему кодированию.»');
    expect(context).toContain('доказательства: [#u1], [#u2]');
    expect(context).toContain('2026-07-01');

    // Rejected and Archived beliefs must NEVER be injected!
    expect(context).not.toContain('Искажение: пользователь ненавидит программирование.');
    expect(context).not.toContain('Устаревшее убеждение.');
  });

  it('Requirement 3 & 4: Competitive floor (400 chars) protects belief from large retrieval eviction', async () => {
    await AIConsolidationService.saveBelief(mockBeliefPassed);

    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    MemoryFlagsService.setFlag('ff_memory_assembler_retrieval', true);
    MemoryFlagsService.setFlag('ff_memory_assembler_beliefs', true);

    // Large retrieval block near budget limit
    const hugeDocContent = 'А'.repeat(5_500);

    const context = await AIMemoryAssembler.assembleMemoryContext({
      documentContent: hugeDocContent,
      globalBudgetChars: 6_000,
    });

    expect(context).not.toBeNull();
    // Belief with 400 floor must survive
    expect(context).toContain('[Убеждение]');
  });

  it('Requirement 4: Salience ranking — a 12-unit belief outranks a 2-unit belief', async () => {
    const thinBelief: AIBelief = {
      id: 'belief-thin',
      belief: 'Тонкое наблюдение.',
      evidence: [{ id: 'u20', date: '2026-07-01', snippet: 'Одно соображение.' }],
      firstSeenAt: '2026-07-01',
      clusterSize: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      judgeVerdict: 'PASSED',
      unitIds: ['u20'],
      isArchived: false,
    };

    await AIConsolidationService.saveBelief(thinBelief);
    await AIConsolidationService.saveBelief(mockBeliefPassed);

    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    MemoryFlagsService.setFlag('ff_memory_assembler_beliefs', true);

    const context = await AIMemoryAssembler.assembleMemoryContext({
      query: 'утренний код',
    });

    expect(context).not.toBeNull();
    const strongIdx = context!.indexOf('Пользователь отдает преимущество утреннему кодированию.');
    const thinIdx = context!.indexOf('Тонкое наблюдение.');

    expect(strongIdx).toBeGreaterThan(-1);
    expect(thinIdx).toBeGreaterThan(-1);
    // Stronger belief (clusterSize 12) outranks thin belief (clusterSize 2)
    expect(strongIdx).toBeLessThan(thinIdx);
  });

  it('Requirement 6: Seam Test — belief firstSeenAt date survives date guard (extractFirstSeenDates & sanitizeFirstSeenDates)', async () => {
    const datedBelief: AIBelief = {
      id: 'belief-date-seam',
      belief: 'Пользователь впервые перешел на антигравитацию.',
      evidence: [{ id: 'u30', date: '2026-07-12', snippet: 'Старт антигравитации.' }],
      firstSeenAt: '2026-07-12',
      clusterSize: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      judgeVerdict: 'PASSED',
      unitIds: ['u30'],
      isArchived: false,
    };

    await AIConsolidationService.saveBelief(datedBelief);

    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    MemoryFlagsService.setFlag('ff_memory_assembler_beliefs', true);

    const assembledContext = await AIMemoryAssembler.assembleMemoryContext();
    expect(assembledContext).not.toBeNull();

    // 1. Assert extractFirstSeenDates finds belief's firstSeenAt date
    const extractedDates = extractFirstSeenDates(assembledContext);
    expect(extractedDates).toContain('2026-07-12');

    // 2. Assert dateGuard does NOT strip valid date from response
    const modelReply = 'Эту мысль ты впервые записал 12 июля 2026 года.';
    const sanitizedReply = sanitizeFirstSeenDates(modelReply, extractedDates);

    expect(sanitizedReply).toBe('Эту мысль ты впервые записал 12 июля 2026 года.');
  });
});
