# Facet-summary judge (subsystem C)

**Date:** 2026-06-30
**Status:** approved design, pre-implementation
**Part of:** self-tuning facet system (A auto-taxonomy ✓ → B threshold tuning → **C LLM judge**). This spec covers **C v1 only** (summary-quality judging); structural critique and threshold tuning are out of scope.

## Problem

Facet summaries (`summarizeFacet`) still confabulate even after the anti-confabulation prompt: on the author's real profile, the "Rejection and trust resilience" facet summary called the therapist **Лариса** a "коллега", the acquaintance **Наташа** a "партнёр", and the supervisor **Феруза** a "клиент". These are factual errors a reader catches immediately by checking against the notes. There is no automated check — a bad summary ships as-is.

This subsystem adds an **LLM judge** that compares each facet summary against structured ground-truth and triggers a targeted re-summary when it finds confabulation or wrong people-roles. Fully automatic — no manual review.

## Goals

1. Detect confabulation in facet summaries — especially **wrong people-roles** — by grounding the judge in structured facts (not free LLM opinion).
2. Auto-correct: feed the judge's specific complaint back into `summarizeFacet` and re-summarize, then re-judge once.
3. Bounded cost: **one batch judge call per pass** for all facets; re-summarize only the flagged ones; at most one corrective round.

## Non-goals (later cycles)

- Structural critique (merge/split duplicate facets, propose missing themes) — a C extension.
- Threshold tuning — subsystem B.
- Judging the taxonomy itself — subsystem A's concern.
- User-facing review UI — v1 is fully automatic.

## Architecture

### 1. `judgeFacets` — new server callable (`functions/src/ai/judgeFacets.ts`)
- Infra, **exempt from per-user limits** (`tryReserveGlobalRequest` only), same pattern as `summarizeFacet`/`deriveTaxonomy`.
- **Input (zod):** `{ facets: { facetId: string; label: string; summary: string; evidence: string }[] }` (1–20 facets). `evidence` is the compact ground-truth block built client-side (see §2).
- **One batch call** reviews all facets at once (cost ≈ 1 LLM call per pass, not N).
- Model `gpt-oss-20b` via `generate`, `json: true`, `maxTokens: 8192`, `repairTruncatedJson` salvage.
- **System prompt:** "Сверь каждое описание с приведёнными ФАКТАМИ (роли людей, темы). Отметь только то, что ПРОТИВОРЕЧИТ фактам или выдумано (имена, роли, события, числа, которых нет в фактах). Не придирайся к стилю." No injection check on evidence (derived metadata — same lesson as `deriveTaxonomy`).
- **Output (zod):** `{ verdicts: { facetId: string; ok: boolean; issues: string[]; hint: string }[] }`. `hint` is a one-line corrective instruction for the re-summary (e.g. «Лариса — терапевт, не коллега; Наташа — знакомая, не партнёр»).

### 2. Evidence builder — client pure function (`AIFacetJudgeService.buildEvidence`)
- For a facet: from its `noteIds`, aggregate over the matching `aiSummaries`:
  - **People:** dedup `mentionedPeople` → `имя → роль` list (the role ground-truth).
  - **Themes / insights:** top-N most frequent themes + a sample of insights.
  - Optionally 1–2 short raw excerpts from `chunkTexts`.
- Produces a compact string. Pure and testable; no network.

### 3. `summarizeFacet` gains an optional `correction`
- `functions/src/ai/summarizeFacet.ts`: input schema adds `correction: z.string().max(500).nullish()`. When present, append to the system/user prompt: «УЧТИ ПОПРАВКУ: {correction}». Backward-compatible (absent → current behavior).
- `AIService.summarizeFacet` wrapper passes `correction` through.

### 4. `AIFacetJudgeService.review()` — client orchestrator (`src/features/ai/services/AIFacetJudgeService.ts`)
1. Load facets (`AIProfileFacetService.getAll()`) + `aiSummaries`.
2. Build `evidence` per facet (§2).
3. One `AIService.judgeFacets({ facets })` call → verdicts.
4. For each `!ok` verdict: re-summarize via `AIService.summarizeFacet({ notes, focus: label, correction: hint })`; re-judge that single facet once. If the re-judge is `ok`, write the corrected summary; if it still fails, **keep the original summary** (conservative — never replace with an unverified correction) and stop (no second round).
5. Write updated summaries to the facet store (`db.put('aiProfileFacets', …)`).
- Returns `{ judged: number; corrected: number }`.

### 5. Trigger
- A pass after facets are (re)summarized — called from the indexer flow alongside `resummarizeDirty`, on the facets just produced. Self-guards: no facets → no call. Bounded: 1 batch judge + ≤1 re-summary per flagged facet + 1 re-judge round.

## Data flow

```
aiProfileFacets + aiSummaries
   └─buildEvidence(per facet)──▶ judgeFacets (1 batch LLM call)
        └─verdicts[{ok,issues,hint}]
             └─for !ok──▶ summarizeFacet(focus,label, correction=hint) ──re-judge×1──▶ store
```

## Cost / safety

- **1 batch judge call per pass**; re-summaries only for flagged facets (usually few); 1 corrective round max — no infinite loop.
- Judge is **grounded in structured facts** (people-roles, themes) → far fewer hallucinated critiques than a free-form critic.
- Limit-exempt infra guard; off the hot path (background).
- Privacy: same boundary as `summarizeFacet`/`deriveTaxonomy` — sees derived metadata + short excerpts.
- Reasoning-model truncation handled by `maxTokens` + salvage (see `gptoss-reasoning-truncates-json`).

## Testing

- **Evidence builder (unit):** aggregates/dedupes people-roles + themes from synthetic aiSummaries for a facet's noteIds; stable output.
- **Judge response parse (unit):** zod + salvage recover verdicts from a truncated response.
- **Re-summary wiring (unit):** a `!ok` verdict calls `summarizeFacet` with the `hint` as `correction` and writes the result; an all-`ok` batch writes nothing.
- **Contract (`judgeFacets`, live):** synthetic facet where summary says "коллега Лариса" but evidence says role=терапевт → verdict `ok:false` with a role-fix hint. Validated against live Fireworks (like prior callables).
- **Ground-truth (success criterion):** on the author's profile, the people-role errors (Лариса/Наташа/Феруза) are flagged and the corrected summary no longer mislabels them.

## Verification (success criteria)

1. A summary contradicting the structured people-roles is flagged `ok:false` with a corrective hint.
2. The flagged facet is re-summarized with the hint and the wrong role is fixed.
3. An all-correct facet set produces no re-summaries (no needless cost/churn).
4. One batch judge call per pass; ≤1 corrective round per facet.
5. Typecheck + lint clean; unit/contract tests pass; functions build clean.

## Open parameters (defaults, tunable)

- Corrective rounds: 1.
- Batch size: all facets in one call (cap 20; chunk if more).
- Evidence: top 8 themes, up to 10 people, 2 excerpts/facet.
