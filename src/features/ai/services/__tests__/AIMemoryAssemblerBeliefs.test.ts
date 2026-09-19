import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllLocalStores } from '../../../../core/storage/localDb';
import { AIMemoryAssembler, MAX_BELIEF_CANDIDATES_PER_TURN } from '../AIMemoryAssembler';
import { AIConsolidationService, type AIBelief } from '../AIConsolidationService';
import { MemoryFlagsService } from '../memoryFlags';
import { InjectionJournal } from '../injectionJournal';
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
      { id: 'summary-doc1', date: '2026-07-01', snippet: 'Пишу код в 7 утра.' },
      { id: 'timeline-doc2-0', date: '2026-07-05', snippet: 'Утренний код идет быстрее.' },
    ],
    firstSeenAt: '2026-07-01',
    clusterSize: 12,
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
    judgeVerdict: 'PASSED',
    unitIds: ['summary-doc1', 'timeline-doc2-0'],
    isArchived: false,
  };

  const mockBeliefRejected: AIBelief = {
    id: 'belief-rejected',
    belief: 'Искажение: пользователь ненавидит программирование.',
    evidence: [{ id: 'summary-doc3', date: '2026-07-02', snippet: 'Устал от багов.' }],
    firstSeenAt: '2026-07-02',
    clusterSize: 1,
    createdAt: Date.now() - 500,
    updatedAt: Date.now() - 500,
    judgeVerdict: 'REJECTED',
    unitIds: ['summary-doc3'],
    isArchived: false,
  };

  const mockBeliefArchived: AIBelief = {
    id: 'belief-archived',
    belief: 'Устаревшее убеждение.',
    evidence: [{ id: 'summary-doc4', date: '2025-01-01', snippet: 'Старая мысль.' }],
    firstSeenAt: '2025-01-01',
    clusterSize: 2,
    createdAt: Date.now() - 2000,
    updatedAt: Date.now() - 2000,
    judgeVerdict: 'PASSED',
    unitIds: ['summary-doc4'],
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

  it('Requirement 1 & 2: With flag on & shadow off, published belief maps to real document IDs [#doc1], [#doc2]', async () => {
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
    // Summary & timeline evidence unit IDs mapped to real document IDs!
    expect(context).toContain('доказательства: [#doc1], [#doc2]');
    expect(context).not.toContain('[#summary-doc1]');
    expect(context).not.toContain('[#timeline-doc2-0]');
    expect(context).toContain('2026-07-01');

    // Rejected and Archived beliefs must NEVER be injected!
    expect(context).not.toContain('Искажение: пользователь ненавидит программирование.');
    expect(context).not.toContain('Устаревшее убеждение.');
  });

  it('Belief built from chat-memory-only units emits no unresolvable [#id] citation', async () => {
    const chatMemoryBelief: AIBelief = {
      id: 'belief-chat-mem',
      belief: 'Пользователь любит ночные прогулки.',
      evidence: [{ id: 'mem-uuid-12345', date: '2026-07-10', snippet: 'Гуляю ночью.' }],
      firstSeenAt: '2026-07-10',
      clusterSize: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      judgeVerdict: 'PASSED',
      unitIds: ['mem-uuid-12345'],
      isArchived: false,
    };

    await AIConsolidationService.saveBelief(chatMemoryBelief);

    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    MemoryFlagsService.setFlag('ff_memory_assembler_beliefs', true);

    const context = await AIMemoryAssembler.assembleMemoryContext();
    expect(context).not.toBeNull();
    expect(context).toContain('[Убеждение] «Пользователь любит ночные прогулки.» (впервые записал 2026-07-10)');
    // No unresolvable chat-memory UUID citations!
    expect(context).not.toContain('доказательства:');
    expect(context).not.toContain('[#mem-uuid-12345]');
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
      evidence: [{ id: 'summary-doc20', date: '2026-07-01', snippet: 'Одно соображение.' }],
      firstSeenAt: '2026-07-01',
      clusterSize: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      judgeVerdict: 'PASSED',
      unitIds: ['summary-doc20'],
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
      evidence: [{ id: 'summary-doc30', date: '2026-07-12', snippet: 'Старт антигравитации.' }],
      firstSeenAt: '2026-07-12',
      clusterSize: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      judgeVerdict: 'PASSED',
      unitIds: ['summary-doc30'],
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

  it('MIND-1: Caps belief candidates to MAX_BELIEF_CANDIDATES_PER_TURN (3) in journal', async () => {
    const now = Date.now();
    // Seed 10 valid beliefs with distinct clusterSize and updatedAt, deliberately out of order
    const seedOrder = [5, 2, 10, 1, 8, 3, 9, 4, 7, 6];
    for (const i of seedOrder) {
      await AIConsolidationService.saveBelief({
        id: `belief-seed-${i}`,
        belief: `Убеждение номер ${i}: кастомная мысль ${i}`,
        evidence: [{ id: `summary-doc${i}`, date: '2026-07-01', snippet: `Сниппет ${i}` }],
        firstSeenAt: '2026-07-01',
        clusterSize: i * 5, // 5 to 50
        createdAt: now - (20 - i) * 1000,
        updatedAt: now - (20 - i) * 1000,
        judgeVerdict: 'PASSED',
        unitIds: [`summary-doc${i}`],
        isArchived: false,
      });
    }

    await AIMemoryAssembler.assembleMemoryContext();

    const entry = InjectionJournal.getLatestEntry();
    expect(entry).not.toBeNull();

    const beliefCandidates = entry!.candidates.filter(c => c.category === 'belief');
    // At most 3 belief candidates appear in journal, NOT 10 (falsification of old behaviour)
    expect(beliefCandidates.length).toBeLessThanOrEqual(MAX_BELIEF_CANDIDATES_PER_TURN);
    expect(beliefCandidates.length).toBe(3);

    // The 3 that remain are the top 3 by salience/sim, not array insertion order
    const candidateIds = beliefCandidates.map(c => c.id);
    expect(candidateIds).toContain('comp-belief-belief-seed-10');
    expect(candidateIds).toContain('comp-belief-belief-seed-9');
    expect(candidateIds).toContain('comp-belief-belief-seed-8');
    // The lowest salience one must NOT be among the kept candidates
    expect(candidateIds).not.toContain('comp-belief-belief-seed-1');
  });

  it('MIND-1: Respects query similarity in combination with salience for top-N selection', async () => {
    const now = Date.now();
    // Seed beliefs where one has lower clusterSize but exact query match
    await AIConsolidationService.saveBelief({
      id: 'belief-high-salience',
      belief: 'Общая мысль без совпадения ключевых слов',
      evidence: [],
      firstSeenAt: '2026-07-01',
      clusterSize: 30,
      createdAt: now,
      updatedAt: now,
      judgeVerdict: 'PASSED',
      unitIds: [],
      isArchived: false,
    });

    await AIConsolidationService.saveBelief({
      id: 'belief-query-match',
      belief: 'Специфический термин квантовая запутанность в коде',
      evidence: [],
      firstSeenAt: '2026-07-01',
      clusterSize: 25,
      createdAt: now,
      updatedAt: now,
      judgeVerdict: 'PASSED',
      unitIds: [],
      isArchived: false,
    });

    for (let i = 1; i <= 8; i++) {
      await AIConsolidationService.saveBelief({
        id: `belief-filler-${i}`,
        belief: `Наполнитель база ${i}`,
        evidence: [],
        firstSeenAt: '2026-07-01',
        clusterSize: 2,
        createdAt: now - 50000,
        updatedAt: now - 50000,
        judgeVerdict: 'PASSED',
        unitIds: [],
        isArchived: false,
      });
    }

    await AIMemoryAssembler.assembleMemoryContext({
      query: 'квантовая запутанность',
    });

    const entry = InjectionJournal.getLatestEntry();
    const beliefCandidates = entry!.candidates.filter(c => c.category === 'belief');
    expect(beliefCandidates.length).toBe(3);
    const candidateIds = beliefCandidates.map(c => c.id);
    expect(candidateIds).toContain('comp-belief-belief-query-match');
  });
});
