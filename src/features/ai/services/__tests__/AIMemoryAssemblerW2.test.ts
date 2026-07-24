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

describe('AG-MIND-W2 Full Memory Assembler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    MemoryFlagsService.resetFlags();
    InjectionJournal.clearJournal();
  });

  it('mandatory band is never dropped even under tiny budget pressure', async () => {
    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    vi.mocked(AILexiconService.getVoiceMap).mockResolvedValue(null);
    vi.mocked(AIThemeLedgerService.getActive).mockResolvedValue([]);


    const result = await AIMemoryAssembler.assembleMemoryContext({
      attachedContent: 'This is an important attached note content that must never be dropped.',
      globalBudgetChars: 10, // Tiny budget!
    });

    expect(result).toContain('This is an important attached note content');

    const entry = InjectionJournal.getLatestEntry();
    expect(entry?.mandatoryInjected.length).toBe(1);
  });

  it('produces shadow logging and metrics in InjectionJournal', async () => {
    vi.mocked(AILexiconService.getVoiceMap).mockResolvedValue({
      terms: [{ word: 'залипание', count: 3, uniqueMonths: 2 }],
      generatedAt: Date.now(),
      formattedPromptSnippet: 'залипание (3x)',
    });

    vi.mocked(AIThemeLedgerService.getActive).mockResolvedValue([
      {
        id: 'theme-1',
        theme: 'синдром самозванца',
        themeVector: [],
        firstSeenAt: '2026-05-10',
        lastReinforcedAt: '2026-06-01',
        count: 5,
        emotionalWeight: 0.8,
        tier: 'active',
        evidence: [
          {
            noteId: 'doc-1',
            eventDate: '2026-05-10',
            sentence: 'Опять почувствовал себя самозванцем',
          },
        ],
      },
    ]);

    await AIMemoryAssembler.assembleMemoryContext({
      query: 'залипание',
      dialogueId: 'dlg-shadow-test',
    });

    const journal = InjectionJournal.getLatestEntry();
    expect(journal).not.toBeNull();
    expect(journal?.dialogueId).toBe('dlg-shadow-test');
    expect(journal?.shadowComparison).toBeDefined();
    expect(journal?.shadowComparison?.overlapRatio).toBeGreaterThan(0);
  });

  it('respects shadow mode vs cutover feature flag', async () => {
    vi.mocked(AILexiconService.getVoiceMap).mockResolvedValue({
      terms: [{ word: 'залипание', count: 3, uniqueMonths: 2 }],
      generatedAt: Date.now(),
      formattedPromptSnippet: 'залипание (3x)',
    });

    vi.mocked(AIThemeLedgerService.getActive).mockResolvedValue([]);

    // 1. Shadow mode active (default)
    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', true);
    const shadowResult = await AIMemoryAssembler.assembleMemoryContext({
      userPortrait: 'Independent analytical thinker',
    });

    // Shadow mode returns legacy result (voice candidate only, portrait ignored in legacy thin assembler)
    expect(shadowResult).toContain('залипание');
    expect(shadowResult).not.toContain('Independent analytical thinker');

    // 2. Cutover active (shadow mode false)
    MemoryFlagsService.setFlag('ff_memory_assembler_shadow', false);
    const cutoverResult = await AIMemoryAssembler.assembleMemoryContext({
      userPortrait: 'Independent analytical thinker',
    });

    // Cutover includes competitive candidates (portrait + voice)
    expect(cutoverResult).toContain('Independent analytical thinker');
    expect(cutoverResult).toContain('залипание');
  });
});
