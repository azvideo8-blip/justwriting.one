import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIMemoryAssembler } from '../AIMemoryAssembler';
import { AILexiconService } from '../AILexiconService';
import { AIThemeLedgerService } from '../AIThemeLedgerService';

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

describe('AIMemoryAssembler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null if no voice map and no theme ledger candidates exist', async () => {
    vi.mocked(AILexiconService.getVoiceMap).mockResolvedValue(null);
    vi.mocked(AIThemeLedgerService.getActive).mockResolvedValue([]);

    const result = await AIMemoryAssembler.assembleMemoryContext();
    expect(result).toBeNull();
  });

  it('assembles voice map and active theme ledger candidates into memoryContext', async () => {
    vi.mocked(AILexiconService.getVoiceMap).mockResolvedValue({
      terms: [{ word: 'залипание', count: 3, uniqueMonths: 2 }],
      generatedAt: 123456789,
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

    const result = await AIMemoryAssembler.assembleMemoryContext();
    expect(result).not.toBeNull();
    expect(result).toContain('Пользователь часто использует свои слова: залипание (3x)');
    expect(result).toContain('Эту мысль («синдром самозванца») ты впервые записал 2026-05-10');
    expect(result).toContain('Дословная цитата: «Опять почувствовал себя самозванцем»');
  });

  it('handles errors gracefully if a producer service fails', async () => {
    vi.mocked(AILexiconService.getVoiceMap).mockRejectedValue(new Error('IDB failure'));
    vi.mocked(AIThemeLedgerService.getActive).mockResolvedValue([]);

    const result = await AIMemoryAssembler.assembleMemoryContext();
    expect(result).toBeNull();
  });
});
