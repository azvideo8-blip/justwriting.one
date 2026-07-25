import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIMemoryAssembler } from '../AIMemoryAssembler';
import { AILexiconService } from '../AILexiconService';
import { AIThemeLedgerService } from '../AIThemeLedgerService';
import { MemoryFlagsService } from '../memoryFlags';
import { InjectionJournal } from '../injectionJournal';

vi.mock('../AILexiconService', () => ({
  AILexiconService: {
    getVoiceMap: vi.fn(),
  },
}));

vi.mock('../AIThemeLedgerService', () => ({
  AIThemeLedgerService: {
    getActive: vi.fn(),
  },
}));

describe('AG-MIND-W2 Shadow & Cutover Test Suite', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    MemoryFlagsService.resetFlags();
    InjectionJournal.clearJournal();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  it('Regression Invariance: with _shadow=true, returned memoryContext matches thin collector output', async () => {
    vi.mocked(AILexiconService.getVoiceMap).mockResolvedValue({
      terms: [{ word: 'прокрастинация', count: 4, uniqueMonths: 2 }],
      generatedAt: Date.now(),
      formattedPromptSnippet: 'прокрастинация (4x)',
    });

    vi.mocked(AIThemeLedgerService.getActive).mockResolvedValue([]);

    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', true);

    const result = await AIMemoryAssembler.assembleMemoryContext({
      userPortrait: 'Analytical writer focused on clarity',
      proactiveBlock: '[Context]: Proactive turn 1 snippet',
    });

    // When shadow is true, return value is legacy thin collector output (voice map only)
    expect(result).toBe('Пользователь часто использует свои слова: прокрастинация (4x)');
    expect(result).not.toContain('Analytical writer');

    // But InjectionJournal records production baseline comparison (userPortrait + proactiveBlock + voice)
    const journalEntry = InjectionJournal.getLatestEntry();
    expect(journalEntry).not.toBeNull();
    expect(journalEntry?.shadowComparison?.legacyResult).toContain('[Портрет пользователя]: Analytical writer focused on clarity');
    expect(journalEntry?.shadowComparison?.legacyResult).toContain('[Context]: Proactive turn 1 snippet');
  });

  it('Feature flags persist to localStorage and reload correctly', () => {
    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    MemoryFlagsService.setFlag('ff_memory_assembler_chat_memory', true);

    expect(MemoryFlagsService.getFlags().ff_memory_assembler_shadow).toBe(false);
    expect(MemoryFlagsService.getFlags().ff_memory_assembler_chat_memory).toBe(true);

    // Simulate page reload
    MemoryFlagsService.reloadFlags();

    expect(MemoryFlagsService.getFlags().ff_memory_assembler_shadow).toBe(false);
    expect(MemoryFlagsService.getFlags().ff_memory_assembler_chat_memory).toBe(true);
  });

  it('Per-block Cutover: independently enables portrait and turn-1 candidates when shadow=false', async () => {
    vi.mocked(AILexiconService.getVoiceMap).mockResolvedValue(null);
    vi.mocked(AIThemeLedgerService.getActive).mockResolvedValue([]);

    // Turn off shadow mode & enable portrait + turn-1 cutovers
    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    MemoryFlagsService.setFlag('ff_memory_assembler_portrait', true);
    MemoryFlagsService.setFlag('ff_memory_assembler_turn1', true);

    const result = await AIMemoryAssembler.assembleMemoryContext({
      userPortrait: 'Strategic product thinker',
      proactiveBlock: '[Связанные заметки]: Project strategy',
    });

    expect(result).toContain('Strategic product thinker');
    expect(result).toContain('[Связанные заметки]: Project strategy');
  });

  it('Per-block Cutover: chat_memory flag gates its block in BOTH directions', async () => {
    vi.mocked(AILexiconService.getVoiceMap).mockResolvedValue({
      terms: [{ word: 'прокрастинация', count: 4, uniqueMonths: 2 }],
      generatedAt: Date.now(),
      formattedPromptSnippet: 'прокрастинация (4x)',
    });
    vi.mocked(AIThemeLedgerService.getActive).mockResolvedValue([]);

    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);

    // Flag ON — the block is injected.
    MemoryFlagsService.setFlag('ff_memory_assembler_chat_memory', true);
    const enabled = await AIMemoryAssembler.assembleMemoryContext({});
    expect(enabled).toContain('прокрастинация (4x)');

    // Flag OFF — the block is gone. Rollback for cutover step 1 depends on this;
    // the condition here used to be OR'd with `!shadow`, which is always true in
    // cutover mode, so the flag gated nothing and could not be rolled back.
    MemoryFlagsService.setFlag('ff_memory_assembler_chat_memory', false);
    const disabled = await AIMemoryAssembler.assembleMemoryContext({});
    expect(disabled ?? '').not.toContain('прокрастинация');
  });

  it('Mandatory band (attached note) is never dropped under any budget pressure', async () => {
    vi.mocked(AILexiconService.getVoiceMap).mockResolvedValue(null);
    vi.mocked(AIThemeLedgerService.getActive).mockResolvedValue([]);

    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);

    const result = await AIMemoryAssembler.assembleMemoryContext({
      attachedContent: 'CRITICAL ATTACHED CONTENT',
      globalBudgetChars: 15, // Tiny budget!
    });

    expect(result).toContain('CRITICAL ATTACHED CONTENT');

    const stats = InjectionJournal.getStats();
    expect(stats.mandatoryDropsCount).toBe(0);
  });

  it('Evicts oldest entries when journal buffer exceeds 200 entries', () => {
    for (let i = 0; i < 215; i++) {
      InjectionJournal.logEntry({
        dialogueId: `dlg-${i}`,
        candidates: [],
        mandatoryInjected: [],
        competitiveInjected: [],
      });
    }

    const entries = InjectionJournal.getEntries(300);
    expect(entries.length).toBe(200);
    expect(entries[0]!.dialogueId).toBe('dlg-214');
  });

  it('Computes JournalStats correctly for Diagnostics UI', () => {
    InjectionJournal.logEntry({
      dialogueId: 'dlg-1',
      candidates: [
        { id: 'c1', category: 'voice', band: 'competitive', textSnippet: 'voice', charLength: 10, selected: true },
        { id: 'c2', category: 'portrait', band: 'competitive', textSnippet: 'portrait', charLength: 50, selected: false, droppedReason: 'budget_exceeded' },
      ],
      mandatoryInjected: [],
      competitiveInjected: ['voice'],
      shadowComparison: {
        legacyResult: 'voice portrait',
        w2Result: 'voice',
        overlapRatio: 0.5,
        wouldHaveAdded: [],
        wouldHaveDropped: ['portrait'],
      },
    });

    const stats = InjectionJournal.getStats(6000);
    expect(stats.totalTurns).toBe(1);
    expect(stats.medianOverlap).toBe(0.5);
    expect(stats.mandatoryDropsCount).toBe(0);
    expect(stats.wouldHaveDroppedByCategory['portrait']).toBe(1);
  });

  it('Stats: no shadow samples reads as "no data", not as perfect overlap', () => {
    const stats = InjectionJournal.getStats(6000);

    // An empty journal previously returned 1.0 here, i.e. a flawless score with
    // zero evidence — the go/no-go bar must never be read off an empty sample.
    expect(stats.totalTurns).toBe(0);
    expect(stats.medianOverlap).toBeNull();
    expect(stats.p90Overlap).toBeNull();
  });

  it('Stats: p90 budget is indexed against its own sample, not the overlap sample', () => {
    // Ten turns with budget usage 10..100 chars and NO shadowComparison, so the
    // overlaps array stays empty while budgetUsages has ten entries. Sharing one
    // index across both arrays made p90 budget read position 0 — the smallest
    // value — and understated usage against the go/no-go budget criterion.
    for (let i = 1; i <= 10; i++) {
      InjectionJournal.logEntry({
        dialogueId: `budget-${i}`,
        candidates: [],
        mandatoryInjected: [],
        competitiveInjected: ['x'.repeat(i * 10)],
      });
    }

    const stats = InjectionJournal.getStats(6000);
    expect(stats.totalTurns).toBe(10);
    expect(stats.medianOverlap).toBeNull(); // no shadow samples at all
    expect(stats.p90BudgetUsage).toBe(100); // floor(10 * 0.9) -> index 9 -> 100 chars
  });
});
