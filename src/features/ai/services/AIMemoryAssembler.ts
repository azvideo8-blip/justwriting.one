import { AILexiconService } from './AILexiconService';
import { AIThemeLedgerService } from './AIThemeLedgerService';
import { AIConsolidationService } from './AIConsolidationService';
import { computeSalience } from './salience';
import { selectWithMMR, textJaccardSimilarity } from '../utils/mmr';
import { MemoryFlagsService } from './memoryFlags';
import { InjectionJournal, EvaluatedCandidateRecord, calculateOverlapRatio } from './injectionJournal';
import { sanitizeAiInputShared } from '../../../shared/ai/buildChatPrompt';

export interface MemoryCandidateItem {
  id: string;
  category: 'safety' | 'attached_note' | 'persona' | 'portrait' | 'voice' | 'first_seen' | 'quote' | 'retrieval' | 'thread' | 'turn1' | 'belief';
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
  query?: string | null | undefined;
  attachedDocumentId?: string | null | undefined;
  attachedContent?: string | null | undefined;
  userPortrait?: string | null | undefined;
  proactiveBlock?: string | null | undefined;
  documentContent?: string | null | undefined; // RAG / search context
  personaId?: string | null | undefined;
  customSystemPrompt?: string | null | undefined;
  dialogueId?: string | null | undefined;
  globalBudgetChars?: number | undefined; // Default 6,000 chars
}

export function extractDocumentIdFromEvidenceId(evidenceId: string): string | null {
  if (!evidenceId || typeof evidenceId !== 'string') return null;

  const summaryMatch = evidenceId.match(/^summary-(.+)$/);
  if (summaryMatch && summaryMatch[1]) {
    return summaryMatch[1];
  }

  const timelineMatch = evidenceId.match(/^timeline-(.+)-\d+$/);
  if (timelineMatch && timelineMatch[1]) {
    return timelineMatch[1];
  }

  return null;
}

export function extractDocumentIdsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.matchAll(/\[#([a-zA-Z0-9_-]+)\]/g);
  const ids: string[] = [];
  for (const m of matches) {
    if (m[1]) ids.push(m[1]);
  }
  return [...new Set(ids)];
}

export const AIMemoryAssembler = {
  /**
   * Assembles memory context using W2 two-band architecture with MMR ranking,
   * category floors/caps, shadow mode logging to InjectionJournal, and per-block cutovers.
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
    // A. User Portrait (Self-Model) - Floor: 600 chars
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

    // B. Turn-1 Proactive Block - Floor: 400 chars
    if (params?.proactiveBlock) {
      competitiveItems.push({
        id: 'comp-turn1',
        category: 'turn1',
        band: 'competitive',
        text: params.proactiveBlock,
        source: 'proactiveBlock',
        count: 3,
        emotionalWeight: 0.6,
        lastReinforcedAt: now,
        floorChars: 400,
      });
    }

    // C. Voice Candidate (W4) - Floor: 200 chars
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
      /* ignore producer failure */
    }

    // D. Theme Ledger Candidates (W1) - Floor: 100 chars
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
      /* ignore producer failure */
    }

    // E. Retrieval Context (RAG) - Cap: 4,000 chars
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

    // F. Consolidated Semantic Beliefs (W3) - Floor: 400 chars
    try {
      const allBeliefs = await AIConsolidationService.getAllBeliefs();
      const validBeliefs = allBeliefs.filter(b => b.judgeVerdict !== 'REJECTED' && !b.isArchived);
      for (const b of validBeliefs) {
        const docIds = [...new Set(
          b.evidence
            .map(e => extractDocumentIdFromEvidenceId(e.id))
            .filter((id): id is string => Boolean(id))
        )];

        const evidenceRefs = docIds.length > 0
          ? `, доказательства: ${docIds.map(id => `[#${id}]`).join(', ')}`
          : '';

        const text = `[Убеждение] «${b.belief}» (впервые записал ${b.firstSeenAt}${evidenceRefs})`;
        competitiveItems.push({
          id: `comp-belief-${b.id}`,
          category: 'belief',
          band: 'competitive',
          text,
          source: 'AIConsolidationService',
          count: b.clusterSize,
          emotionalWeight: 0.7,
          lastReinforcedAt: b.updatedAt,
          floorChars: 400,
        });
      }
    } catch {
      /* ignore producer failure */
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

    // --- 4. Budget Allocation (Mandatory First, Category Floors, then MMR) ---
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
        // Check if item has a floor that can be satisfied
        if (item.floorChars && usedBudget + item.floorChars <= globalBudget) {
          const truncated = textToAdd.slice(0, item.floorChars);
          usedBudget += truncated.length;
          selectedCompetitive.push({ ...item, text: truncated });

          evaluatedRecords.push({
            id: item.id,
            category: item.category,
            band: 'competitive',
            textSnippet: truncated.slice(0, 100),
            charLength: truncated.length,
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
    }

    // Combine final selected lines for W2 assembled output
    const selectedMandatoryLines = mandatoryItems.map(m => sanitizeAiInputShared(m.text));
    const selectedCompetitiveLines = selectedCompetitive.map(c => sanitizeAiInputShared(c.text));

    const w2Result = [...selectedMandatoryLines, ...selectedCompetitiveLines].join('\n') || null;

    // --- 5. Compute Legacy Baseline Output (Actual Live Injections) ---
    // Production injected: userPortrait + proactiveBlock + thin collector lines (voice, first_seen, quote)
    const legacyParts: string[] = [];
    if (params?.userPortrait) {
      legacyParts.push(`[Портрет пользователя]: ${params.userPortrait}`);
    }
    if (params?.proactiveBlock) {
      legacyParts.push(params.proactiveBlock);
    }

    const legacyVoice = competitiveItems.find(i => i.category === 'voice')?.text;
    const legacyFirstSeen = competitiveItems.find(i => i.category === 'first_seen')?.text;
    const legacyQuote = competitiveItems.find(i => i.category === 'quote')?.text;
    const legacyThinLines = [legacyVoice, legacyFirstSeen, legacyQuote].filter(Boolean) as string[];
    if (legacyThinLines.length > 0) {
      legacyParts.push(legacyThinLines.join('\n'));
    }

    const legacyResult = legacyParts.length > 0 ? legacyParts.join('\n') : null;

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
        wouldHaveDropped: legacyParts.filter(line => !w2Result?.includes(line)),
      },
    });

    // --- 7. Shadow Mode & Per-Block Cutover Return Logic ---
    if (flags.ff_memory_assembler_shadow) {
      // In shadow mode, return legacy thin collector output for memoryContext
      return legacyThinLines.join('\n') || null;
    }

    // Cutover mode: assemble output based on active block flags
    const cutoverLines: string[] = [...selectedMandatoryLines];

    for (const c of selectedCompetitive) {
      if (c.category === 'portrait' && flags.ff_memory_assembler_portrait) {
        cutoverLines.push(sanitizeAiInputShared(c.text));
      } else if (c.category === 'turn1' && flags.ff_memory_assembler_turn1) {
        cutoverLines.push(sanitizeAiInputShared(c.text));
      } else if (c.category === 'retrieval' && flags.ff_memory_assembler_retrieval) {
        cutoverLines.push(sanitizeAiInputShared(c.text));
      } else if (
        (c.category === 'voice' || c.category === 'first_seen' || c.category === 'quote') &&
        flags.ff_memory_assembler_chat_memory
      ) {
        cutoverLines.push(sanitizeAiInputShared(c.text));
      } else if (c.category === 'belief' && flags.ff_memory_assembler_beliefs) {
        cutoverLines.push(sanitizeAiInputShared(c.text));
      }
    }

    return cutoverLines.join('\n') || null;
  },
};
