# Algorithmic threshold self-tuning (subsystem B)

**Date:** 2026-06-30
**Status:** approved design, pre-implementation
**Part of:** self-tuning facet system (A auto-taxonomy ✓ → **B threshold tuning** → C judge ✓). This spec covers **B v1 only**.

## Problem

Facet domain thresholds were hand-tuned on the author's corpus (v0.7.37) and the per-user derived taxonomy (A) ships each domain with a flat default threshold of `0.47`. Neither adapts to a given user's data: a domain whose seed happens to match a lot of a user's chunks over-binds (the author's "partner" captured 56/90 notes before manual tuning); a domain that barely matches under-binds. Manually tuning per user does not scale.

This subsystem auto-tunes each domain's cosine threshold from the user's own chunk-score distribution, with no LLM cost, so every facet build self-corrects over/under-binding.

## Key insight

Domain **assignment** (which determines the per-domain note distribution) is pure cosine math — the same primary/secondary/PROF-8 logic `build()` already runs, minus the LLM summaries. So the threshold→distribution loop can be **simulated offline for free** and iterated to convergence before the real build, instead of paying for repeated rebuilds.

## Goals

1. After embedding the domain seeds in `build()`, **simulate** the assignment and **iteratively, with damping** adjust each domain's threshold until every domain's note-share is within a target band `[2 notes .. 40% of the corpus]`.
2. Persist the tuned thresholds into the per-user taxonomy store so they carry across builds.
3. Zero LLM cost; stable (no oscillation); bounded (clamped thresholds, capped iterations).

## Non-goals (later)

- Cohesion/silhouette metrics; dropping or merging domains (structural — a later cycle).
- Tuning the hardcoded default taxonomy (cold-start before A bootstraps) — B persists only when a derived taxonomy exists.
- Tuning `MERGE_THRESHOLD`, `SECONDARY_BUMP`, `suggestK`, or the discovered-cluster knobs.

## Architecture

### 1. `simulateAssignment` — pure function (`src/features/ai/utils/thresholdTuner.ts`)
- Input: `chunks: { noteId: string; vector: number[] }[]`, `domains: { id: string; vec: number[]; threshold: number }[]`.
- Replicates `build()`'s assignment exactly: per chunk, `sim` to each domain; best domain whose `sim ≥ threshold` is the primary; when a primary exists, other domains with `sim ≥ threshold + SECONDARY_BUMP (0.03)` are secondaries; no primary → leftover.
- Output: `Map<domainId, number>` of **unique** note counts per domain.
- `simulateAssignment` **replicates** `build()`'s primary/secondary/PROF-8 decision (it does not refactor the existing build loop — that loop stays intact to avoid risk to the shipped facet system). A unit test pins parity: on a fixture, `simulateAssignment`'s per-domain counts equal what `build()`'s loop would assign. If the build logic ever changes, that test fails and flags the drift.

### 2. `tuneThresholds` — pure function (`thresholdTuner.ts`)
- Input: `chunks`, `domains` (with starting thresholds), `totalNotes`.
- Loop (≤ `MAX_ITERS` 20):
  - `counts = simulateAssignment(chunks, domains)`.
  - For each domain: `share = counts[id] / totalNotes`. If `counts[id] > CAP_SHARE (0.40) * totalNotes` → `threshold += STEP (0.02)` (over-binding); else if `counts[id] < FLOOR (2)` → `threshold -= STEP` (under-binding). Clamp to `[MIN 0.40 .. MAX 0.60]`.
  - If no domain changed → converged, stop.
- Output: adjusted `domains` thresholds (new `Map<domainId, number>`), plus a `changed` count.
- Damping: fixed small step, only out-of-band domains adjusted, clamp + iteration cap → no runaway, no oscillation (a domain at the clamp edge stops moving).

### 3. Integration in `build()`
- After the domain seed vectors are embedded (`domainVecs`) and chunks gathered, before the assignment loop: call `tuneThresholds(chunks, domainVecs-with-current-thresholds, totalNotes)`. Use the returned thresholds for this build's assignment (replace the `taxonomy.find(...).threshold ?? DOMAIN_THRESHOLD` lookup with the tuned value).
- **Persist:** if a derived taxonomy is stored (`AITaxonomyService.getStored()` non-null), write the tuned thresholds back via `AITaxonomyService.save(...)` (update each domain's `threshold`). If only the default taxonomy is active, skip persistence (use tuned values for this build only).

### 4. `AIThresholdTuner` (thin client wrapper, optional)
- Not strictly needed: the integration lives in `build()`. A named export `tuneThresholds` + `simulateAssignment` from `thresholdTuner.ts` is the public surface. No new service object unless a manual "retune" entry point is wanted later.

## Data flow

```
build(): embeddings → chunks + domainVecs (with stored thresholds)
   └─ tuneThresholds(chunks, domainVecs, totalNotes)   [pure, 0 LLM, ≤20 iters]
        └─ tuned thresholds ──▶ assignment (this build)
        └─ if derived taxonomy stored ──▶ AITaxonomyService.save (persist)
```

## Constraints honored

- **Cost:** zero LLM calls — pure cosine simulation. Negligible CPU (chunks × domains × ~iters).
- **Stability:** damped fixed steps + clamp `[0.40, 0.60]` + ≤20 iterations; only out-of-band domains move.
- **Consistency:** `simulateAssignment` mirrors `build()`'s primary/secondary/PROF-8 via a shared decision helper so simulated and real assignment agree.
- **Scope:** persists only to the derived per-user taxonomy (A); never mutates hardcoded `LIFE_DOMAINS`.

## Testing

- **`simulateAssignment` (unit):** synthetic chunks + domains → expected unique note counts; a chunk with no passing domain is leftover (counted nowhere); secondary needs `threshold + 0.03`.
- **`tuneThresholds` (unit):** an over-binding domain (captures >40%) → its threshold is raised and its count drops into band; an under-binding domain (<2 notes) → threshold lowered; convergence terminates (returns within MAX_ITERS); thresholds never leave `[0.40, 0.60]`; a constructed two-domain case reaches a stable fixed point (no oscillation — running twice from the result is a no-op).
- **Integration:** `build()` with a stored derived taxonomy persists tuned thresholds; with only the default taxonomy, it does not write to `ai_taxonomy`.

## Verification (success criteria)

1. On a synthetic corpus where one domain over-binds, after `build()` that domain's threshold is higher and its note-share is ≤ 40%.
2. Tuning converges (no infinite loop) and thresholds stay within `[0.40, 0.60]`.
3. Tuned thresholds persist to the derived taxonomy and are reused on the next build.
4. Default-taxonomy (cold-start) builds do not write thresholds.
5. Existing facet tests still pass; typecheck + lint clean.

## Open parameters (defaults, tunable)

- `CAP_SHARE = 0.40`, `FLOOR = 2` notes, `STEP = 0.02`, threshold clamp `[0.40, 0.60]`, `MAX_ITERS = 20`, `SECONDARY_BUMP = 0.03` (matches `build()`).
