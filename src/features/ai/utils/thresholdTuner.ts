import { cosineSimilarity } from './vectorSearch';

export interface SimChunk { noteId: string; vector: number[] }
export interface SimDomain { id: string; vec: number[]; threshold: number }

const SECONDARY_BUMP = 0.03;

/** Replicates build()'s primary/secondary/PROF-8 assignment. Returns the set of
 *  unique noteIds assigned to each domain id. */
export function simulateAssignment(chunks: SimChunk[], domains: SimDomain[]): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>();
  for (const d of domains) sets.set(d.id, new Set<string>());
  if (domains.length === 0) return sets;

  for (const ch of chunks) {
    const scores = domains.map(d => ({ id: d.id, sim: cosineSimilarity(ch.vector, d.vec), threshold: d.threshold }));
    let best = scores[0]!;
    for (let i = 1; i < scores.length; i++) best = best.sim >= scores[i]!.sim ? best : scores[i]!;
    if (best.sim < best.threshold) continue; // no primary -> leftover
    sets.get(best.id)!.add(ch.noteId);
    for (const s of scores) {
      if (s.id === best.id) continue;
      if (s.sim >= s.threshold + SECONDARY_BUMP) sets.get(s.id)!.add(ch.noteId);
    }
  }
  return sets;
}

export function simulateCounts(chunks: SimChunk[], domains: SimDomain[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, set] of simulateAssignment(chunks, domains)) out.set(id, set.size);
  return out;
}

const CAP_SHARE = 0.40;
const FLOOR = 2;
const STEP = 0.02;
const MIN_THRESHOLD = 0.40;
const MAX_THRESHOLD = 0.60;
const MAX_ITERS = 20;

export function tuneThresholds(
  chunks: SimChunk[],
  domains: SimDomain[],
  totalNotes: number,
): { thresholds: Map<string, number>; changed: number; iterations: number } {
  const th = new Map<string, number>(domains.map(d => [d.id, d.threshold]));
  const start = new Map(th);
  let iterations = 0;

  for (; iterations < MAX_ITERS; iterations++) {
    const doms: SimDomain[] = domains.map(d => ({ id: d.id, vec: d.vec, threshold: th.get(d.id)! }));
    const counts = simulateCounts(chunks, doms);
    let moved = false;
    for (const d of domains) {
      const c = counts.get(d.id) ?? 0;
      const t = th.get(d.id)!;
      if (c > CAP_SHARE * totalNotes && t < MAX_THRESHOLD) {
        th.set(d.id, Math.min(MAX_THRESHOLD, t + STEP));
        moved = true;
      } else if (c < FLOOR && t > MIN_THRESHOLD) {
        th.set(d.id, Math.max(MIN_THRESHOLD, t - STEP));
        moved = true;
      }
    }
    if (!moved) break;
  }

  let changed = 0;
  for (const [id, t] of th) if (Math.abs(t - (start.get(id) ?? t)) > 1e-9) changed++;
  return { thresholds: th, changed, iterations };
}
