import { AILexiconService } from './AILexiconService';
import { AIThemeLedgerService } from './AIThemeLedgerService';
import { sanitizeAiInputShared } from '../../../shared/ai/buildChatPrompt';

export interface MemoryCandidate {
  text: string;
  category: 'voice' | 'first_seen' | 'quote';
  source?: string;
}

export interface MemoryAssemblerParams {
  attachedDocumentId?: string | null;
  attachedContent?: string | null;
}

export const AIMemoryAssembler = {
  /**
   * Assembles thin memory context candidates from W4 (AILexiconService) and W1 (AIThemeLedgerService)
   * for Stage-1 MIND chat integration.
   * Hard limits: Voice <= ~200 chars, First-seen/quote <= 3 lines total.
   * Invariant: 0 new LLM or embedding calls.
   */
  async assembleMemoryContext(params?: MemoryAssemblerParams): Promise<string | null> {
    const candidates: MemoryCandidate[] = [];

    // 1. Collect W4 Voice Candidate (if B3 signal gate passes)
    try {
      const voiceMap = await AILexiconService.getVoiceMap();
      if (voiceMap && voiceMap.formattedPromptSnippet && voiceMap.terms.length > 0) {
        const text = `Пользователь часто использует свои слова: ${voiceMap.formattedPromptSnippet}`.slice(0, 200);
        candidates.push({
          text,
          category: 'voice',
          source: 'AILexiconService',
        });
      }
    } catch {
      /* ignore producer failure */
    }

    // 2. Collect W1 Theme Ledger Candidates (first-seen date & verbatim quote)
    try {
      const activeRecords = await AIThemeLedgerService.getActive();
      if (activeRecords.length > 0) {
        // Sort by lastReinforcedAt (most active theme first)
        const sortedRecords = [...activeRecords].sort((a, b) => (b.lastReinforcedAt > a.lastReinforcedAt ? 1 : -1));
        const topRecord = sortedRecords[0];

        if (topRecord) {
          const firstSeenText = `Эту мысль («${topRecord.theme}») ты впервые записал ${topRecord.firstSeenAt}`;
          candidates.push({
            text: firstSeenText,
            category: 'first_seen',
            source: 'AIThemeLedgerService',
          });

          // Surface verbatim quote from top evidence if available
          const topEvidence = topRecord.evidence[0];
          if (topEvidence && topEvidence.sentence) {
            const quoteText = `Дословная цитата: «${topEvidence.sentence}»`;
            candidates.push({
              text: quoteText,
              category: 'quote',
              source: 'AIThemeLedgerService',
            });
          }
        }
      }
    } catch {
      /* ignore producer failure */
    }


    // W2 STUB: Injection Journal (shadow logging & audit) will be registered here.

    if (candidates.length === 0) {
      return null;
    }

    // Per-category hard limits / floors arbitration
    const voiceCandidates = candidates.filter(c => c.category === 'voice').slice(0, 1);
    const ledgerCandidates = candidates.filter(c => c.category === 'first_seen' || c.category === 'quote').slice(0, 2);

    const selected = [...voiceCandidates, ...ledgerCandidates];
    if (selected.length === 0) {
      return null;
    }

    const lines = selected.map(c => sanitizeAiInputShared(c.text));
    return lines.join('\n');
  },
};
