# Personal auto-taxonomy for AI profile facets (subsystem A)

**Date:** 2026-06-30
**Status:** approved design, pre-implementation
**Part of:** self-tuning facet system (A auto-taxonomy → B algorithmic threshold tuning → C LLM judge). This spec covers **A only**; B and C are separate later cycles.

## Problem

The facet pipeline assigns each user's notes to a **hardcoded** set of life-domains (`src/features/ai/utils/lifeDomains.ts`: Деньги, Дети, Партнёр, Родители, Призвание, Практика, Творчество, Внутренняя работа). Those domains were hand-authored by reading one user's (the author's) 90-note corpus. For any other user they will be wrong — a different person's life has different dominant themes, and manually retuning the taxonomy per user does not scale.

The manual step that does not scale is **authoring the taxonomy**: a human read the corpus and named its real domains. This spec automates that step — an LLM derives each user's personal domains from their own notes — so the facet system works per-user without manual tuning.

## Goals

1. Replace the hardcoded `LIFE_DOMAINS` with a **per-user derived taxonomy** of 6–10 domains (`{id, label, seed}`), produced by an LLM from the user's existing per-note summaries.
2. Keep the taxonomy **stable over time** (hybrid lifecycle): derive once at bootstrap, grow incrementally, full re-derive rarely.
3. Change **only** the domain source. The rest of `build()` (thresholds, primary/secondary, PROF-8, discovered clusters, summaries) is untouched.
4. Fully automatic, **read-only** for the end user in v1.

## Non-goals (separate cycles / v2)

- B (algorithmic threshold self-tuning) and C (LLM-judge critic).
- End-user editing/pinning/renaming of domains.
- Encrypted cloud sync of the taxonomy (local-only, regenerable in v1).
- Changing thresholds, prompts, or clustering math.

## Architecture

Four units; maximum reuse of existing infrastructure (`aiSummaries`, `AIService.embed`, `domainSeeds` cache, discovered clusters, the facet store).

### 1. `deriveTaxonomy` — new server callable (`functions/src/ai/deriveTaxonomy.ts`)
- Infra function, **exempt from per-user limits** (global cost guard only), same pattern as `summarizeFacet`/`embed` (see memory `ai-infra-calls-bypass-limits`).
- **Input:** a compact digest of the user's `aiSummaries` — for each note, its `themes`, `insights`, and `mentionedPeople` (≈3 lines/note), NOT raw note text. This is cheaper, smaller, and crosses a lower trust boundary than `summarizeFacet` (which sees raw excerpts).
- **Output (zod-validated):** `{ domains: { label: string; seed: string }[] }`, 6–10 items. `seed` is a rich Russian description suitable for embedding (like the hand-authored seeds). Reject/clamp out-of-range counts; de-dupe near-identical labels.
- Model: same obedient model as facets (`gpt-oss-20b` via Fireworks), with the `repairTruncatedJson` salvage pattern (see memory `gptoss-reasoning-truncates-json`) and an anti-confabulation system prompt (names/themes only from the digest).
- One LLM call per bootstrap / re-derive. Not on a hot path.

### 2. Taxonomy storage — `localStorage`, per user (no IndexedDB)
- Stored as a single JSON blob under a `localStorage` key (e.g. `ai_taxonomy`), mirroring the existing portrait storage (`AIProfileService.savePortrait` → `ai_user_portrait`). The taxonomy is small (6–10 records) and regenerable.
- **Deliberately NOT a new IndexedDB store**: a new store forces a `localDb` schema version bump, which risks breaking stale PWA bundles (see memory `sw-indexeddb-staleness`). `localStorage` sidesteps that entirely.
- Shape: `{ domains: { id, label, seed, derivedAt, noteCountAtDerive, source: 'default' | 'derived', origin?: 'bootstrap' | 'incremental' | 'rederive' }[], version: 1 }`. Local-only, no cloud sync / encryption in v1.

### 3. `AITaxonomyService` — client (`src/features/ai/services/AITaxonomyService.ts`)
- `getActive(): Promise<LifeDomain[]>` — returns the derived taxonomy if present, else the default `LIFE_DOMAINS` (cold-start fallback). This is the single seam `build()` consumes.
- `ensureBootstrap()` — if no derived taxonomy and summarized-note count ≥ `BOOTSTRAP_MIN` (20), call `deriveTaxonomy`, embed each seed via `AIService.embed`, write the store.
- `rederive()` — full re-derive (user button / periodic), with **label continuity**: match new domains to old by cosine of seed/centroid vectors, carry the old `label` forward when a clear match exists, so the user does not see topics silently renamed.
- Seed-vector caching reuses/generalizes the existing `domainSeeds.ts` in-memory cache (currently keyed to the static `LIFE_DOMAINS`; generalize to an arbitrary domain list).

### 4. `build()` consumes the taxonomy
- One change in `AIProfileFacetService.build()`: replace `for (const d of LIFE_DOMAINS)` (seed embedding loop) with `await AITaxonomyService.getActive()`. Everything downstream (thresholds via `domain.threshold ?? DEFAULT`, primary/secondary, discovered, summaries) is unchanged. Derived domains carry a default threshold (the same 0.45–0.50 band) until subsystem B tunes them.

## Lifecycle (hybrid)

- **Cold-start (`< BOOTSTRAP_MIN` summarized notes):** `getActive()` returns the existing `LIFE_DOMAINS` as a universal default (`source: 'default'`). Facets still work, just generic.
- **Bootstrap (≥ `BOOTSTRAP_MIN`, no derived taxonomy):** triggered in `useEmbeddingIndexer` background flow (after summaries exist). Derives, embeds, stores. Next facet build uses it.
- **Incremental growth:** when the discovered-cluster mechanism surfaces the **same** unnamed theme across ≥2 builds (stable centroid, ≥ `MIN_FACET_NOTES`), promote it to a named domain via a small LLM label+seed call and append to the taxonomy. Reuses the existing discovered pipeline.
- **Full re-derive:** user-triggered ("Обновить темы") or after a large corpus delta (e.g. +`REDERIVE_DELTA` 40 notes since `noteCountAtDerive`). Runs `deriveTaxonomy` over the full digest, then label-continuity matching against the prior taxonomy.

## Data flow

```
aiSummaries (themes/insights/people)
   └─digest──▶ deriveTaxonomy (1 LLM call, server)
                  └─domains[{label,seed}]──▶ AITaxonomyService
                       ├─ AIService.embed(seed) per domain ─▶ seed vectors (cached)
                       └─ write taxonomy to localStorage (ai_taxonomy)
ai_taxonomy ──getActive()──▶ AIProfileFacetService.build()  (unchanged downstream)
```

## Constraints honored

- **Cost/limits:** bootstrap is 1 infra LLM call on compact summaries; re-derive is rare. Off the hot path. Limit-exempt infra guard only.
- **Privacy:** the deriver sees summaries, not raw notes — a lower exposure than the existing `summarizeFacet`. Same Fireworks server boundary; no new external surface.
- **Reasoning-model truncation:** `deriveTaxonomy` uses the salvage + adequate `maxTokens` pattern already established.

## Testing

- **Unit:** label-continuity matching (old→new by cosine, carry-forward on clear match, new label when none); discovered→domain promotion gate (stability across builds + min notes); cold-start fallback returns `LIFE_DOMAINS` below threshold.
- **Contract (`deriveTaxonomy`):** synthetic summaries digest → returns a zod-valid 6–10 domain list with unique ids and non-empty seeds; out-of-range counts clamped; salvage recovers a truncated response.
- **Real-corpus validation (success criterion):** run the deriver over the author's 90-note summaries; the output should approximate the hand-authored taxonomy (Призвание / Творчество / Практика / Деньги / Семья / Внутренняя работа). This is the ground-truth check that automation reproduces the manual result.

## Verification (success criteria)

1. With a derived taxonomy present, a facet build assigns notes to the **derived** domains, not `LIFE_DOMAINS`.
2. Below `BOOTSTRAP_MIN` notes, the system falls back to default domains and still builds facets.
3. A full re-derive preserves labels for domains that clearly persist (no gratuitous renames).
4. Author's-corpus deriver output matches the hand-authored domains within reason (manual review).
5. Typecheck + lint clean; unit/contract tests pass.

## Open parameters (defaults, tunable)

- `BOOTSTRAP_MIN = 20` summarized notes.
- `REDERIVE_DELTA = 40` notes since last derive (auto re-derive trigger).
- Domain count target 6–10.
- Default threshold for derived domains: 0.47 (mid of the tuned band) until subsystem B exists.
