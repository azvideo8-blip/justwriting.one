# Threshold Self-Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-tune each facet domain's cosine threshold from the user's own chunk-score distribution (no LLM), so every build self-corrects over/under-binding.

**Architecture:** Two pure functions — `simulateAssignment` (replicates build()'s primary/secondary/PROF-8 assignment from cosine scores → per-domain note counts) and `tuneThresholds` (iterative, damped: nudge out-of-band domains until every domain's note-share is in `[2 notes .. 40%]`). `build()` runs `tuneThresholds` on its already-embedded domain vectors before assignment, uses the tuned thresholds, and persists them to the per-user derived taxonomy.

**Tech Stack:** TypeScript, Vitest. Pure functions, no network.

## Global Constraints

- Zero LLM calls — pure cosine simulation. `SECONDARY_BUMP = 0.03` (must match `build()`).
- Band: `CAP_SHARE = 0.40` of corpus (over-binding ceiling), `FLOOR = 2` notes (under-binding floor). `STEP = 0.02`. Threshold clamp `[0.40, 0.60]`. `MAX_ITERS = 20`.
- Persist tuned thresholds ONLY when a derived taxonomy is stored (`AITaxonomyService.getStored()` non-null); never mutate hardcoded `LIFE_DOMAINS`.
- Do NOT refactor `build()`'s existing assignment loop — `simulateAssignment` replicates its logic separately.
- Commit after each task. Do NOT push or deploy — the human gates that.

**Reference signatures (existing code):**
- `cosineSimilarity(a: number[], b: number[]): number` (`src/features/ai/utils/vectorSearch.ts`).
- `build()` assignment (`AIProfileFacetService.ts`): per chunk, `best = scores.reduce((a, b) => a.sim >= b.sim ? a : b)`; `bestPassed = best.sim >= best.threshold`; if passed, best is primary and every other domain with `sim >= threshold + 0.03` is a secondary; else the chunk is leftover. A domain's note set = unique `noteId`s assigned (primary or secondary).
- `AITaxonomyService.getStored(): TaxonomyDomain[] | null`, `.save(domains: TaxonomyDomain[]): void` (`src/features/ai/services/AITaxonomyService.ts`). `TaxonomyDomain` has a `threshold?: number`.

---

### Task 1: `simulateAssignment` + counts

**Files:**
- Create: `src/features/ai/utils/thresholdTuner.ts`
- Test: `src/features/ai/utils/__tests__/thresholdTuner.test.ts`

**Interfaces:**
- Produces:
  - `interface SimChunk { noteId: string; vector: number[] }`
  - `interface SimDomain { id: string; vec: number[]; threshold: number }`
  - `simulateCounts(chunks: SimChunk[], domains: SimDomain[]): Map<string, number>` (unique note count per domain id).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/ai/utils/__tests__/thresholdTuner.test.ts
import { describe, it, expect } from 'vitest';
import { simulateCounts, type SimChunk, type SimDomain } from '../thresholdTuner';

// Unit vectors so cosine == dot product. 2 domains along the axes.
const dA: SimDomain = { id: 'A', vec: [1, 0], threshold: 0.5 };
const dB: SimDomain = { id: 'B', vec: [0, 1], threshold: 0.5 };

describe('simulateCounts', () => {
  it('assigns a chunk to its best passing domain (primary)', () => {
    const chunks: SimChunk[] = [{ noteId: 'n1', vector: [1, 0] }]; // sim A=1, B=0
    const c = simulateCounts(chunks, [dA, dB]);
    expect(c.get('A')).toBe(1);
    expect(c.get('B')).toBe(0);
  });

  it('a chunk passing no domain is leftover (counted nowhere)', () => {
    const chunks: SimChunk[] = [{ noteId: 'n1', vector: [0.6, 0.6] }]; // sim ~0.42 each < 0.5
    const c = simulateCounts(chunks, [dA, dB]);
    expect(c.get('A')).toBe(0);
    expect(c.get('B')).toBe(0);
  });

  it('a secondary needs threshold + 0.03 once a primary exists', () => {
    // chunk near A (passes), and B at exactly its threshold (0.5) — must NOT
    // count as secondary because secondary needs >= 0.53.
    const chunks: SimChunk[] = [{ noteId: 'n1', vector: [0.866, 0.5] }]; // simA=0.866, simB=0.5
    const c = simulateCounts(chunks, [dA, dB]);
    expect(c.get('A')).toBe(1);
    expect(c.get('B')).toBe(0);
  });

  it('counts unique notes, not chunks', () => {
    const chunks: SimChunk[] = [
      { noteId: 'n1', vector: [1, 0] },
      { noteId: 'n1', vector: [0.99, 0.01] },
    ];
    const c = simulateCounts(chunks, [dA, dB]);
    expect(c.get('A')).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/ai/utils/__tests__/thresholdTuner.test.ts`
Expected: FAIL — `Cannot find module '../thresholdTuner'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/ai/utils/thresholdTuner.ts
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
    if (best.sim < best.threshold) continue; // no primary → leftover
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/ai/utils/__tests__/thresholdTuner.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/utils/thresholdTuner.ts src/features/ai/utils/__tests__/thresholdTuner.test.ts
git commit -m "feat(ai): simulateAssignment — pure facet assignment for threshold tuning"
```

---

### Task 2: `tuneThresholds`

**Files:**
- Modify: `src/features/ai/utils/thresholdTuner.ts`
- Test: `src/features/ai/utils/__tests__/thresholdTuner.test.ts`

**Interfaces:**
- Produces: `tuneThresholds(chunks: SimChunk[], domains: SimDomain[], totalNotes: number): { thresholds: Map<string, number>; changed: number; iterations: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// add to thresholdTuner.test.ts
import { tuneThresholds } from '../thresholdTuner';

describe('tuneThresholds', () => {
  it('raises the threshold of an over-binding domain until its share drops', () => {
    // Domain A at threshold 0.40 captures everything; B captures little.
    const dA: SimDomain = { id: 'A', vec: [1, 0], threshold: 0.40 };
    const dB: SimDomain = { id: 'B', vec: [0, 1], threshold: 0.40 };
    // 10 notes all leaning A; only 1 toward B.
    const chunks: SimChunk[] = [
      ...Array.from({ length: 9 }, (_, i) => ({ noteId: `a${i}`, vector: [1, 0] })),
      { noteId: 'b0', vector: [0, 1] },
    ];
    const res = tuneThresholds(chunks, [dA, dB], 10);
    // A over-binds (9/10 = 90% > 40%) → its threshold must have risen above 0.40.
    expect(res.thresholds.get('A')!).toBeGreaterThan(0.40);
    expect(res.iterations).toBeLessThanOrEqual(20);
  });

  it('keeps thresholds inside [0.40, 0.60]', () => {
    const dA: SimDomain = { id: 'A', vec: [1, 0], threshold: 0.59 };
    const chunks: SimChunk[] = Array.from({ length: 20 }, (_, i) => ({ noteId: `n${i}`, vector: [1, 0] }));
    const res = tuneThresholds(chunks, [dA], 20);
    expect(res.thresholds.get('A')!).toBeLessThanOrEqual(0.60);
    expect(res.thresholds.get('A')!).toBeGreaterThanOrEqual(0.40);
  });

  it('is a fixed point: running again from the result changes nothing', () => {
    const dA: SimDomain = { id: 'A', vec: [1, 0], threshold: 0.40 };
    const dB: SimDomain = { id: 'B', vec: [0, 1], threshold: 0.40 };
    const chunks: SimChunk[] = [
      ...Array.from({ length: 9 }, (_, i) => ({ noteId: `a${i}`, vector: [1, 0] })),
      { noteId: 'b0', vector: [0, 1] },
    ];
    const first = tuneThresholds(chunks, [dA, dB], 10);
    const settled: SimDomain[] = [
      { id: 'A', vec: [1, 0], threshold: first.thresholds.get('A')! },
      { id: 'B', vec: [0, 1], threshold: first.thresholds.get('B')! },
    ];
    const second = tuneThresholds(chunks, settled, 10);
    expect(second.changed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/ai/utils/__tests__/thresholdTuner.test.ts -t tuneThresholds`
Expected: FAIL — `tuneThresholds` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// add to thresholdTuner.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/ai/utils/__tests__/thresholdTuner.test.ts`
Expected: PASS (all simulate + tune tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/utils/thresholdTuner.ts src/features/ai/utils/__tests__/thresholdTuner.test.ts
git commit -m "feat(ai): tuneThresholds — damped distribution-based threshold tuning"
```

---

### Task 3: Integrate into `build()` + persist

**Files:**
- Modify: `src/features/ai/services/AIProfileFacetService.ts`

**Interfaces:**
- Consumes: `tuneThresholds`, `AITaxonomyService.getStored/save`.

- [ ] **Step 1: Tune before assignment, persist to the derived taxonomy**

In `build()`, after `domainVecs` is built and before the chunk-assignment loop, insert:

```ts
import { tuneThresholds } from '../utils/thresholdTuner';
// (AITaxonomyService is already imported)

// B: self-tune thresholds from this user's chunk-score distribution (no LLM).
const totalNotesForTune = new Set(chunks.map(c => c.noteId)).size;
const tuneDomains = domainVecs.map(d => ({
  id: d.id,
  vec: d.vec,
  threshold: taxonomy.find(ld => ld.id === d.id)?.threshold ?? DOMAIN_THRESHOLD,
}));
const tuned = tuneThresholds(
  chunks.map(c => ({ noteId: c.noteId, vector: c.vector })),
  tuneDomains,
  totalNotesForTune,
).thresholds;

// Persist tuned thresholds back to the derived taxonomy (skip for the default).
const storedTax = AITaxonomyService.getStored();
if (storedTax && tuned.size > 0) {
  AITaxonomyService.save(storedTax.map(d => ({ ...d, threshold: tuned.get(d.id) ?? d.threshold })));
}
```

Then in the assignment loop, replace the threshold lookup:

```ts
// BEFORE
threshold: taxonomy.find(ld => ld.id === d.id)?.threshold ?? DOMAIN_THRESHOLD,
// AFTER
threshold: tuned.get(d.id) ?? DOMAIN_THRESHOLD,
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Verify existing facet tests still pass**

Run: `npx vitest run src/features/ai/`
Expected: PASS (tuning is a pure pre-step; with a default taxonomy nothing is persisted and behaviour for a single-or-balanced domain set is unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/features/ai/services/AIProfileFacetService.ts
git commit -m "feat(ai): build() self-tunes domain thresholds before assignment"
```

---

### Task 4: Full check (manual gate)

- [ ] **Step 1:** Run `npm run typecheck && npm run lint && npx vitest run src/features/ai/`. Expected: all green.
- [ ] **Step 2:** Report to the human. Real-data validation: on a user with a derived taxonomy, an over-binding domain's note-share should drop after a rebuild and the persisted `ai_taxonomy` thresholds should reflect the tuning. No deploy needed (client-only; ships with the frontend).

---

## Self-Review

- **Spec coverage:** simulateAssignment (T1) ✓; tuneThresholds damped/clamped/converging (T2) ✓; build() integration + persist-only-when-derived (T3) ✓; full check (T4) ✓. Band `[2..40%]`, step 0.02, clamp `[0.40,0.60]`, ≤20 iters, SECONDARY_BUMP 0.03 all enforced in T1/T2.
- **Placeholders:** none — every code step has concrete code and exact expected output.
- **Type consistency:** `SimChunk`, `SimDomain`, `simulateCounts`, `tuneThresholds(...).thresholds: Map<string,number>` are consistent across T1–T3; the build() threshold lookup is replaced with the same `tuned` map.
