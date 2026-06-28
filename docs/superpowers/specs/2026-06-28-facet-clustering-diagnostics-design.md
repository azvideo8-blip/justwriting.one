# Facet clustering — tests + diagnostics (Phase #1)

**Date:** 2026-06-28
**Status:** approved design, pre-implementation
**Scope:** foundation for tuning the embedding-profile-clustering thresholds. Adds test coverage and a dev-only diagnostic surface. **Does NOT change any threshold or `AIProfileFacetService.build()` behavior.**

## Problem

The facet pipeline (`AIProfileFacetService`, `facetClustering`, `lifeDomains`) ships with hardcoded, never-validated thresholds (`DOMAIN_THRESHOLD 0.45`, per-domain 0.38–0.55, `PRIMARY_THRESHOLD 0.55`, `MERGE_THRESHOLD 0.80`, `INCREMENT_THRESHOLD 0.48`, `suggestK = clamp(notes/4, 4, 18)`) and **zero test coverage** for the clustering math. Thresholds can't be tuned on real data because there is no way to see per-note domain cosine scores, and no regression net to protect the working production flow while thresholds move.

This phase builds **visibility only**. Threshold tuning is a separate follow-up that consumes the numbers this phase surfaces.

## Goals

1. Unit tests for the pure clustering functions (deterministic, synthetic vectors, no network).
2. A dev-only diagnostic panel that shows, per note, the top domain cosine scores and pass/fail against thresholds, plus corpus-level distribution.
3. Cache domain seed embeddings so the panel (and future callers) don't re-embed 6 seeds on every run.

## Non-goals

- No change to any threshold value.
- No change to `build()`, `incrementalUpdate()`, or `resummarizeDirty()` logic.
- No change to production-visible UI (panel is `import.meta.env.DEV` gated).
- Not wiring the new seed cache into `build()` (candidate follow-up, out of scope here to keep `build()` untouched).

## Unit A — Clustering unit tests

New files under `src/features/ai/utils/__tests__/`:

### `facetClustering.test.ts`
- `normalize`: unit L2 norm; zero vector returns a copy (no NaN).
- `clusterChunks`:
  - **determinism** — same input twice → identical centroids + assignments (farthest-first init has no randomness).
  - separates two clearly-distant synthetic clusters into the right buckets.
  - `k` is clamped to `points.length` (k larger than points doesn't crash or produce empty centroids).
  - a note whose chunks span two clusters appears in both clusters' `noteIds`.
- `mergeSimilarClusters`:
  - two near-duplicate centroids (cosine > threshold) collapse into one, union of `noteIds`, summed `chunkCount`.
  - two distant centroids stay separate.
  - merged centroid is the `chunkCount`-weighted mean.
- `suggestK`: returns 4 below the floor, 18 above the ceiling, `round(n/4)` in between.

### `lifeDomains.test.ts`
- `LIFE_DOMAINS` ids are unique.
- every domain has a non-empty `seed`.
- every `threshold`, when present, is in the open interval (0, 1).

These use hand-built vectors; no `AIService` calls, no mocks of the network.

## Unit B — Seed cache helper

New file `src/features/ai/utils/domainSeeds.ts`:

```ts
export interface DomainSeedVec { id: string; label: string; vec: number[]; threshold: number }
export async function getDomainSeedVectors(): Promise<DomainSeedVec[]>
```

- Embeds each `LIFE_DOMAINS[i].seed` via `AIService.embed` **once**, then caches.
- **Storage: in-memory module-level cache only** (a module variable holding the vectors), keyed by `CURRENT_EMBED_MODEL + CURRENT_EMBED_DIM`. Lives for the browser session; re-embeds once after a reload. **No IndexedDB store and no `localDb` schema bump** — a version bump risks breaking stale PWA bundles (see `sw-indexeddb-staleness`), which is unjustified for a dev-only, manually-triggered tool that re-embeds 6 static seeds at most once per session.
- `embed` is infra and already exempt from per-user limits (see `ai-infra-calls-bypass-limits`), so caching is a cost/latency win, not a correctness requirement.
- Threshold carried through from `LIFE_DOMAINS[i].threshold ?? DOMAIN_THRESHOLD` (export `DOMAIN_THRESHOLD` or pass a default param).

The helper is standalone; `build()` is intentionally left calling its own inline embed loop in this phase.

## Unit C — Diagnostic panel

New file `src/features/ai/components/FacetDiagnostics.tsx`, mounted in `DiagnosticsPage.tsx` next to `<ProfileFacets />`, wrapped so it only renders when `import.meta.env.DEV`.

Behavior on a "Диагностика порогов" button click:
1. Load local `aiEmbeddings` (`AIEmbeddingService.getAll()`) and `documents`.
2. `getDomainSeedVectors()` (cached).
3. For each note: take its chunk vectors, compute cosine to each domain seed, reduce to the note's **best score per domain** (max over chunks). Render:
   - note title + top-3 domains with score, green if `score ≥ domainThreshold` else muted.
   - chunk count, and how many chunks matched no domain (→ would go to `leftover`/discovered).
4. Corpus summary: count of notes assigned per domain, count of notes with no domain, total leftover chunks.

Pure read: no writes to `aiProfileFacets`, no effect on the production build flow. Uses existing `cosineSimilarity` from `vectorSearch`.

### Error/empty states
- No embeddings → message "Сначала проиндексируйте заметки" (mirror existing `ProfileFacets` copy).
- `embed` failure on seeds → toast + abort, leave panel empty.

## Data flow

```
LIFE_DOMAINS.seed ──embed(once,cached)──▶ domainSeedVecs
aiEmbeddings (local) ──per-note chunks──▶ cosine vs seeds ──▶ score matrix ──▶ FacetDiagnostics table
```

## Testing

- Unit A is the test deliverable (run via existing vitest setup: `npm test` / the repo's runner).
- Unit B: a small test for cache hit (second call doesn't call `embed` again) using a stubbed `AIService.embed`.
- Unit C: no automated test (dev-only visual tool); verified manually in the running app.

## Verification (success criteria)

1. `facetClustering.test.ts` + `lifeDomains.test.ts` pass; determinism test green on repeated runs.
2. `domainSeeds` cache test: second `getDomainSeedVectors()` call issues no new `embed`.
3. Typecheck + lint clean.
4. In dev app, the diagnostic panel renders per-note domain scores and the corpus summary against the real local corpus, with no change to existing facet build output.

## Out of scope / follow-ups (later phases)

- **Tuning** the threshold values using the panel's numbers.
- **#3** temporal sparkline.
- **#2** ranked post-candidates list.
- Adopting `getDomainSeedVectors()` inside `build()` to drop its duplicate embed loop.
