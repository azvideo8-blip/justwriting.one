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

export interface RejectedBeliefRecord {
  id: string;
  timestamp: number;
  clusterSize: number;
  firstSeenAt: string;
  reason: string;
  /**
   * Why nothing was published. 'judge_rejected' means the judge returned a
   * verdict and it was a fail — the only signal that says anything about judge
   * calibration. 'evaluation_failed' means we never got a verdict (provider or
   * quota failure), which must NOT be counted as a rejection: a flaky upstream
   * would otherwise read as "the judge is too strict".
   */
  kind: 'judge_rejected' | 'evaluation_failed';
  rewriteAttempted: boolean;
  rejectedTextSnippet: string;
  unitIds: string[];
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
   * Saves a rejected candidate log to IndexedDB `aiBeliefRejections` (capped at 200).
   */
  async saveRejection(rejection: RejectedBeliefRecord): Promise<void> {
    try {
      const db = await getLocalDb();
      await db.put('aiBeliefRejections', rejection as unknown as Record<string, unknown>);

      // Ring-buffer eviction: cap at 200 records
      const all = await db.getAllFromIndex('aiBeliefRejections', 'by-timestamp');
      if (all.length > 200) {
        const toDeleteCount = all.length - 200;
        const oldestToDelete = all.slice(0, toDeleteCount);
        const tx = db.transaction('aiBeliefRejections', 'readwrite');
        for (const item of oldestToDelete) {
          if (item.id) {
            void tx.store.delete(item.id as string);
          }
        }
        await tx.done;
      }
    } catch {
      /* ignore IDB rejection log errors */
    }
  },

  /**
   * Retrieves all logged rejections from IndexedDB `aiBeliefRejections`.
   */
  async getAllRejections(limit = 100): Promise<RejectedBeliefRecord[]> {
    try {
      const db = await getLocalDb();
      const records = await db.getAllFromIndex('aiBeliefRejections', 'by-timestamp');
      const sorted = (records as unknown as RejectedBeliefRecord[]).sort((a, b) => b.timestamp - a.timestamp);
      return sorted.slice(0, limit);
    } catch {
      return [];
    }
  },

  /**
   * Clears the `aiBeliefRejections` log store.
   */
  async clearRejections(): Promise<void> {
    try {
      const db = await getLocalDb();
      await db.clear('aiBeliefRejections');
    } catch {
      /* ignore clear error */
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
      for (const uId of b.unitIds) consolidatedUnitIds.add(uId);
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
   * candidate is NOT published into aiBeliefs and rejection is logged to aiBeliefRejections.
   */
  async consolidateAndJudgeCluster(
    cluster: MemoryClusterCandidate,
  ): Promise<{ belief: AIBelief | null; llmCalls: number }> {
    const evidenceList: AIBeliefEvidence[] = cluster.units.map(u => ({
      id: u.id,
      date: u.date,
      snippet: u.text,
    }));

    let llmCalls = 0;
    let rewriteAttempted = false;

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
      rewriteAttempted = true;
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
        } else if (recheckRes.ok) {
          finalReason = recheckRes.reason;
        } else {
          finalReason = initialJudgeRes.reason;
        }
      } else {
        finalReason = initialJudgeRes.reason;
      }
    }

    // 3. Fail-Open Enforcement
    if (verdict === 'REJECTED') {
      // Do NOT publish distortion to aiBeliefs. Log to capped rejection store instead.
      const rejectionRecord: RejectedBeliefRecord = {
        id: `rej-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        clusterSize: cluster.units.length,
        firstSeenAt: cluster.earliestDate,
        reason: finalReason ?? (initialJudgeRes.ok ? (initialJudgeRes.reason || 'Judge rejection') : 'Summarization or judge failure'),
        kind: initialJudgeRes.ok ? 'judge_rejected' : 'evaluation_failed',
        rewriteAttempted,
        rejectedTextSnippet: candidateBeliefText.slice(0, 300),
        unitIds: cluster.units.map(u => u.id),
      };
      await this.saveRejection(rejectionRecord);
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
  async processConsolidationPass(): Promise<{ processedClusters: number; publishedBeliefs: number; totalLlmCalls: number }> {
    let processedClusters = 0;
    let publishedBeliefs = 0;
    let totalLlmCalls = 0;

    try {
      const units = await this.gatherMemoryUnits();
      if (units.length < 2) {
        return { processedClusters, publishedBeliefs, totalLlmCalls };
      }

      const clusters = this.clusterMemoryUnits(units);

      for (const cluster of clusters) {
        // Governor Budget Check (budget cost: 2 LLM calls per candidate)
        if (!AIBackgroundBudget.canSpend(2)) {
          break;
        }

        const res = await this.consolidateAndJudgeCluster(cluster);
        if (res.llmCalls > 0) {
          AIBackgroundBudget.spend(res.llmCalls);
          totalLlmCalls += res.llmCalls;
        }

        processedClusters++;
        if (res.belief) {
          publishedBeliefs++;
        }
      }
    } catch {
      /* ignore background pass errors */
    }

    return { processedClusters, publishedBeliefs, totalLlmCalls };
  },
};
