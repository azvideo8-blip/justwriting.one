import { getLocalDb, type AIChatMemory } from '../../../core/storage/localDb';
import { AIBackgroundBudget } from './AIBackgroundBudget';
import { computeSalience } from './salience';
import { textJaccardSimilarity } from '../utils/mmr';
import { AIService } from './AIService';

export interface AIBeliefEvidence {
  id: string;
  date: string;
  title?: string;
  snippet?: string;
}

export interface AIBelief {
  id: string;
  belief: string;
  evidence: AIBeliefEvidence[];
  firstSeenAt: string;
  clusterSize: number;
  createdAt: number;
  updatedAt: number;
  judgeVerdict: 'PASSED' | 'REJECTED' | 'REWRITTEN_PASSED';
  judgeReason?: string;
  unitIds: string[];
  isArchived?: boolean;
}

export interface MemoryUnit {
  id: string;
  type: 'chat_memory' | 'summary' | 'timeline';
  text: string;
  date: string;
  salience: number;
}

export interface MemoryClusterCandidate {
  clusterId: string;
  units: MemoryUnit[];
  earliestDate: string;
  salience: number;
}

export interface JudgeResult {
  passed: boolean;
  reason: string;
  correctiveHint?: string;
}

export const AIConsolidationService = {
  /**
   * Retrieves all published beliefs from IndexedDB `aiBeliefs`.
   */
  async getAllBeliefs(): Promise<AIBelief[]> {
    try {
      const db = await getLocalDb();
      const records = await db.getAll('aiBeliefs');
      return (records as unknown as AIBelief[]).sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  },

  /**
   * Saves a published belief to IndexedDB `aiBeliefs`.
   */
  async saveBelief(belief: AIBelief): Promise<void> {
    try {
      const db = await getLocalDb();
      await db.put('aiBeliefs', belief as unknown as Record<string, unknown>);
    } catch {
      /* ignore storage failure */
    }
  },

  /**
   * Gathers candidate episodic memory units (chat memory, timeline, AI summaries)
   * filtering out already consolidated unit IDs.
   */
  async gatherMemoryUnits(): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];
    const publishedBeliefs = await this.getAllBeliefs();
    const consolidatedUnitIds = new Set<string>();

    for (const b of publishedBeliefs) {
      if (b.judgeVerdict !== 'REJECTED') {
        for (const uId of b.unitIds) consolidatedUnitIds.add(uId);
      }
    }

    const now = Date.now();

    try {
      const db = await getLocalDb();

      // 1. Chat memory units
      const chatMemories = await db.getAll('aiChatMemory');
      for (const mem of chatMemories as AIChatMemory[]) {
        if (consolidatedUnitIds.has(mem.id)) continue;
        const ts = mem.updatedAt ?? now;
        const date = new Date(ts).toISOString().slice(0, 10);
        units.push({
          id: mem.id,
          type: 'chat_memory',
          text: mem.text,
          date,
          salience: computeSalience({ count: 2, emotionalWeight: 0.6, lastReinforcedAt: ts }, now),
        });
      }

      // 2. Timeline facts
      const timelineDocs = await db.getAll('aiTimeline');
      for (const t of timelineDocs as Array<{ documentId: string; date?: string; facts?: string[] }>) {
        if (!t.facts) continue;
        const date = t.date ?? new Date().toISOString().slice(0, 10);
        for (let i = 0; i < t.facts.length; i++) {
          const factId = `timeline-${t.documentId}-${i}`;
          if (consolidatedUnitIds.has(factId)) continue;
          units.push({
            id: factId,
            type: 'timeline',
            text: t.facts[i]!,
            date,
            salience: computeSalience({ count: 1, emotionalWeight: 0.5, lastReinforcedAt: Date.parse(date) || now }, now),
          });
        }
      }

      // 3. AI Summaries
      const summaries = await db.getAll('aiSummaries');
      for (const s of summaries as Array<{ documentId: string; summary?: string; createdAt?: number }>) {
        if (!s.summary) continue;
        const sumId = `summary-${s.documentId}`;
        if (consolidatedUnitIds.has(sumId)) continue;
        const ts = s.createdAt ?? now;
        const date = new Date(ts).toISOString().slice(0, 10);
        units.push({
          id: sumId,
          type: 'summary',
          text: s.summary,
          date,
          salience: computeSalience({ count: 3, emotionalWeight: 0.7, lastReinforcedAt: ts }, now),
        });
      }
    } catch {
      /* ignore IDB gather errors */
    }

    return units;
  },

  /**
   * Clusters memory units by textual similarity into candidate clusters,
   * sorted by salience descending so most valuable work is processed first.
   */
  clusterMemoryUnits(units: MemoryUnit[], similarityThreshold = 0.35): MemoryClusterCandidate[] {
    if (units.length < 2) return [];

    const assigned = new Set<string>();
    const rawClusters: MemoryUnit[][] = [];

    for (let i = 0; i < units.length; i++) {
      const u1 = units[i]!;
      if (assigned.has(u1.id)) continue;

      const currentCluster: MemoryUnit[] = [u1];
      assigned.add(u1.id);

      for (let j = i + 1; j < units.length; j++) {
        const u2 = units[j]!;
        if (assigned.has(u2.id)) continue;

        const sim = textJaccardSimilarity(u1.text, u2.text);
        if (sim >= similarityThreshold) {
          currentCluster.push(u2);
          assigned.add(u2.id);
        }
      }

      if (currentCluster.length >= 2) {
        rawClusters.push(currentCluster);
      }
    }

    const candidates: MemoryClusterCandidate[] = rawClusters.map((cluster, idx) => {
      const dates = cluster.map(u => u.date).sort();
      const earliestDate = dates[0] ?? new Date().toISOString().slice(0, 10);
      const totalSalience = cluster.reduce((sum, u) => sum + u.salience, 0);

      return {
        clusterId: `cluster-${earliestDate}-${idx}`,
        units: cluster,
        earliestDate,
        salience: totalSalience / cluster.length,
      };
    });

    // Sort candidates by salience descending (most salient first)
    return candidates.sort((a, b) => b.salience - a.salience);
  },

  /**
   * Evaluates a candidate belief against evidence using AI Judge before publishing.
   * Enforces fail-open behavior: on failure, 1 rewrite attempt is made. If re-judge fails,
   * candidate is NOT published into aiBeliefs.
   */
  async consolidateAndJudgeCluster(
    cluster: MemoryClusterCandidate,
  ): Promise<{ belief: AIBelief | null; llmCalls: number }> {
    const evidenceList: AIBeliefEvidence[] = cluster.units.map(u => ({
      id: u.id,
      date: u.date,
      snippet: u.text,
    }));

    // Count the calls that actually reached the provider, so the governor is
    // charged for work done rather than work attempted. A failing upstream (or a
    // missing callable) must not be able to drain the shared daily budget and
    // starve threads / digests / portrait generation.
    let llmCalls = 0;

    // 1. Initial LLM Summarization into Belief Candidate
    const initialRes = await AIService.summarizeBeliefCluster({
      evidence: evidenceList,
      firstSeenAt: cluster.earliestDate,
    });

    if (!initialRes.ok || !initialRes.belief) {
      return { belief: null, llmCalls };
    }
    llmCalls++;

    let candidateBeliefText = initialRes.belief;

    // 2. Pre-publish AI Judge Evaluation
    const initialJudgeRes = await AIService.judgeBeliefCandidate({
      belief: candidateBeliefText,
      evidence: evidenceList,
    });
    if (initialJudgeRes.ok) llmCalls++;

    let verdict: 'PASSED' | 'REWRITTEN_PASSED' | 'REJECTED' = 'REJECTED';
    let finalReason: string | undefined;

    if (initialJudgeRes.ok && initialJudgeRes.passed) {
      verdict = 'PASSED';
      finalReason = initialJudgeRes.reason;
    } else if (initialJudgeRes.ok) {
      // Attempt 1 Rewrite with corrective hint
      const correctiveHint = initialJudgeRes.correctiveHint ?? initialJudgeRes.reason ?? 'Учти все условия и не делай ложных обобщений.';
      const rewriteRes = await AIService.summarizeBeliefCluster({
        evidence: evidenceList,
        firstSeenAt: cluster.earliestDate,
        correctionHint: correctiveHint,
      });

      if (rewriteRes.ok && rewriteRes.belief) {
        llmCalls++;
        candidateBeliefText = rewriteRes.belief;
        const recheckRes = await AIService.judgeBeliefCandidate({
          belief: candidateBeliefText,
          evidence: evidenceList,
        });
        if (recheckRes.ok) llmCalls++;

        if (recheckRes.ok && recheckRes.passed) {
          verdict = 'REWRITTEN_PASSED';
          finalReason = recheckRes.reason;
        }
      }
    }

    // 3. Fail-Open Enforcement
    if (verdict === 'REJECTED') {
      // Do NOT publish distortion to aiBeliefs. Episodic raw units stay uncompressed.
      return { belief: null, llmCalls };
    }

    const now = Date.now();
    const publishedBelief: AIBelief = {
      id: `belief-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      belief: candidateBeliefText,
      evidence: evidenceList,
      firstSeenAt: cluster.earliestDate,
      clusterSize: cluster.units.length,
      createdAt: now,
      updatedAt: now,
      judgeVerdict: verdict,
      ...(finalReason ? { judgeReason: finalReason } : {}),
      unitIds: cluster.units.map(u => u.id),
      isArchived: false,
    };

    await this.saveBelief(publishedBelief);
    return { belief: publishedBelief, llmCalls };
  },

  /**
   * Process background consolidation pass under governor budget (`AIBackgroundBudget`).
   * Never runs on the chat hot path!
   */
  async processConsolidationPass(): Promise<number> {
    const units = await this.gatherMemoryUnits();
    if (units.length < 2) return 0;

    const clusters = this.clusterMemoryUnits(units);
    let processedCount = 0;

    for (const cluster of clusters) {
      // Each cluster requires 2 LLM calls (1 summary + 1 judge), up to 3 if rewritten
      if (!AIBackgroundBudget.canSpend(2)) {
        break;
      }

      const { belief, llmCalls } = await this.consolidateAndJudgeCluster(cluster);
      // Charge for calls that actually happened. Charging up-front meant a failing
      // provider drained the whole shared daily budget for zero work; it also
      // under-charged the rewrite path, which costs 4 calls rather than 2.
      if (llmCalls > 0) AIBackgroundBudget.spend(llmCalls);
      if (belief) {
        processedCount++;
      }
    }

    return processedCount;
  },
};
