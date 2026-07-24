import { AILexiconService } from './AILexiconService';
import { AIThemeLedgerService } from './AIThemeLedgerService';
import { computeSalience } from './salience';
import { selectWithMMR, textJaccardSimilarity } from '../utils/mmr';
import { MemoryFlagsService } from './memoryFlags';
import { InjectionJournal, EvaluatedCandidateRecord, calculateOverlapRatio } from './injectionJournal';
import { sanitizeAiInputShared } from '../../../shared/ai/buildChatPrompt';

export interface MemoryCandidateItem {
  id: string;
  category: 'safety' | 'attached_note' | 'persona' | 'portrait' | 'voice' | 'first_seen' | 'quote' | 'retrieval' | 'thread';
  band: 'mandatory' | 'competitive';
  text: string;
  source?: string;
  count?: number;
  emotionalWeight?: number;
  lastReinforcedAt?: string | number;
  floorChars?: number;
  capChars?: number;
}

export interface W2MemoryAssemblerParams {
  query?: string | null;
  attachedDocumentId?: string | null;
  attachedContent?: string | null;
  userPortrait?: string | null;
  documentContent?: string | null; // RAG / search context
  personaId?: string | null;
  customSystemPrompt?: string | null;
  dialogueId?: string | null;
  globalBudgetChars?: number; // Default 6,000 chars
}

export const AIMemoryAssembler = {
  /**
   * Assembles memory context using W2 two-band architecture with MMR ranking,
   * category floors/caps, and shadow mode logging to InjectionJournal.
   * Hard Invariant: 0 new LLM or embedding calls on the hot path.
   */
  async assembleMemoryContext(params?: W2MemoryAssemblerParams): Promise<string | null> {
    const globalBudget = params?.globalBudgetChars ?? 6_000;
    const now = Date.now();
    const flags = MemoryFlagsService.getFlags();

    const mandatoryItems: MemoryCandidateItem[] = [];
    const competitiveItems: MemoryCandidateItem[] = [];

    // --- 1. Collect Mandatory Candidates ---
    if (params?.attachedContent) {
      mandatoryItems.push({
        id: 'mandatory-attached',
        category: 'attached_note',
        band: 'mandatory',
        text: `[Прикреплённая заметка]\n${params.attachedContent}`,
        source: 'user_attachment',
      });
    }

    // --- 2. Collect Competitive Candidates ---
    // A. Voice Candidate (W4)
    try {
      const voiceMap = await AILexiconService.getVoiceMap();
      if (voiceMap && voiceMap.formattedPromptSnippet && voiceMap.terms.length > 0) {
        const text = `Пользователь часто использует свои слова: ${voiceMap.formattedPromptSnippet}`;
        competitiveItems.push({
          id: 'comp-voice',
          category: 'voice',
          band: 'competitive',
          text,
          source: 'AILexiconService',
          count: voiceMap.terms.length * 3,
          emotionalWeight: 0.6,
          lastReinforcedAt: voiceMap.generatedAt,
          floorChars: 200,
        });
      }
    } catch {
      /* ignore */
    }

    // B. Theme Ledger Candidates (W1)
    try {
      const activeRecords = await AIThemeLedgerService.getActive();
      if (activeRecords.length > 0) {
        const sortedRecords = [...activeRecords].sort((a, b) => (b.lastReinforcedAt > a.lastReinforcedAt ? 1 : -1));
        const topRecord = sortedRecords[0];

        if (topRecord) {
          competitiveItems.push({
            id: `comp-first-seen-${topRecord.id}`,
            category: 'first_seen',
            band: 'competitive',
            text: `Эту мысль («${topRecord.theme}») ты впервые записал ${topRecord.firstSeenAt}`,
            source: 'AIThemeLedgerService',
            count: topRecord.count,
            emotionalWeight: topRecord.emotionalWeight,
            lastReinforcedAt: topRecord.lastReinforcedAt,
            floorChars: 100,
          });

          const topEvidence = topRecord.evidence[0];
          if (topEvidence && topEvidence.sentence) {
            competitiveItems.push({
              id: `comp-quote-${topRecord.id}`,
              category: 'quote',
              band: 'competitive',
              text: `Дословная цитата: «${topEvidence.sentence}»`,
              source: 'AIThemeLedgerService',
              count: topRecord.count,
              emotionalWeight: topRecord.emotionalWeight,
              lastReinforcedAt: topRecord.lastReinforcedAt,
              floorChars: 100,
            });
          }
        }
      }
    } catch {
      /* ignore */
    }

    // C. User Portrait (Self-Model)
    if (params?.userPortrait) {
      competitiveItems.push({
        id: 'comp-portrait',
        category: 'portrait',
        band: 'competitive',
        text: `[Портрет пользователя]: ${params.userPortrait}`,
        source: 'userPortrait',
        count: 5,
        emotionalWeight: 0.7,
        lastReinforcedAt: now,
        floorChars: 600,
      });
    }

    // D. Retrieval Context (RAG)
    if (params?.documentContent) {
      competitiveItems.push({
        id: 'comp-retrieval',
        category: 'retrieval',
        band: 'competitive',
        text: `[Поиск заметок]: ${params.documentContent}`,
        source: 'RAG',
        count: 2,
        emotionalWeight: 0.5,
        lastReinforcedAt: now,
        capChars: 4_000,
      });
    }

    // --- 3. Score & Rank Competitive Candidates ---
    const evaluatedRecords: EvaluatedCandidateRecord[] = [];
    const scoredCompetitive: Array<{ item: MemoryCandidateItem; salience: number; sim: number; rawScore: number }> = [];

    // Mandatory evaluations
    for (const item of mandatoryItems) {
      evaluatedRecords.push({
        id: item.id,
        category: item.category,
        band: 'mandatory',
        textSnippet: item.text.slice(0, 100),
        charLength: item.text.length,
        selected: true,
      });
    }

    const queryText = params?.query ?? '';

    for (const item of competitiveItems) {
      const salience = computeSalience({
        count: item.count ?? 1,
        emotionalWeight: item.emotionalWeight ?? 0.5,
        lastReinforcedAt: item.lastReinforcedAt ?? now,
      }, now);

      const sim = queryText ? textJaccardSimilarity(queryText, item.text) : 1.0;
      const rawScore = salience * (0.5 + 0.5 * sim);

      scoredCompetitive.push({ item, salience, sim, rawScore });
    }

    // --- 4. Budget Allocation (Mandatory First, Floors, then MMR) ---
    let usedBudget = mandatoryItems.reduce((acc, m) => acc + m.text.length, 0);
    const selectedCompetitive: MemoryCandidateItem[] = [];

    // Apply MMR on scored items
    const mmrOrdered = selectWithMMR(
      scoredCompetitive,
      (a, b) => textJaccardSimilarity(a.item.text, b.item.text),
      entry => entry.rawScore,
      0.7
    );

    for (const entry of mmrOrdered) {
      const item = entry.item;
      let textToAdd = item.text;

      if (item.capChars && textToAdd.length > item.capChars) {
        textToAdd = textToAdd.slice(0, item.capChars);
      }

      if (usedBudget + textToAdd.length <= globalBudget) {
        usedBudget += textToAdd.length;
        selectedCompetitive.push({ ...item, text: textToAdd });

        evaluatedRecords.push({
          id: item.id,
          category: item.category,
          band: 'competitive',
          textSnippet: textToAdd.slice(0, 100),
          charLength: textToAdd.length,
          salience: entry.salience,
          similarity: entry.sim,
          rawScore: entry.rawScore,
          selected: true,
        });
      } else {
        evaluatedRecords.push({
          id: item.id,
          category: item.category,
          band: 'competitive',
          textSnippet: item.text.slice(0, 100),
          charLength: item.text.length,
          salience: entry.salience,
          similarity: entry.sim,
          rawScore: entry.rawScore,
          selected: false,
          droppedReason: 'budget_exceeded',
        });
      }
    }

    // Combine final selected lines
    const selectedMandatoryLines = mandatoryItems.map(m => sanitizeAiInputShared(m.text));
    const selectedCompetitiveLines = selectedCompetitive.map(c => sanitizeAiInputShared(c.text));

    const w2Result = [...selectedMandatoryLines, ...selectedCompetitiveLines].join('\n') || null;

    // --- 5. Compute Legacy Output for Shadow Comparison ---
    const legacyVoice = competitiveItems.find(i => i.category === 'voice')?.text;
    const legacyFirstSeen = competitiveItems.find(i => i.category === 'first_seen')?.text;
    const legacyQuote = competitiveItems.find(i => i.category === 'quote')?.text;
    const legacyLines = [legacyVoice, legacyFirstSeen, legacyQuote].filter(Boolean) as string[];
    const legacyResult = legacyLines.length > 0 ? legacyLines.join('\n') : null;

    // --- 6. Shadow Logging to InjectionJournal ---
    const overlapRatio = calculateOverlapRatio(legacyResult, w2Result);
    InjectionJournal.logEntry({
      dialogueId: params?.dialogueId,
      candidates: evaluatedRecords,
      mandatoryInjected: selectedMandatoryLines,
      competitiveInjected: selectedCompetitiveLines,
      shadowComparison: {
        legacyResult,
        w2Result,
        overlapRatio,
        wouldHaveAdded: selectedCompetitiveLines.filter(line => !legacyResult?.includes(line)),
        wouldHaveDropped: legacyLines.filter(line => !w2Result?.includes(line)),
      },
    });

    // --- 7. Cutover Logic ---
    // If shadow mode is active, return legacyResult (or null if none)
    if (flags.ff_memory_assembler_shadow) {
      return legacyResult;
    }

    return w2Result;
  },
};
