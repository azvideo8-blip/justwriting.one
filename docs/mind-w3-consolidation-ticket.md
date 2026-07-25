# AG-MIND-W3-consolidation — episodic → semantic, with a judge in front of the queryable layer

**Priority:** P1 · the keystone of "infinite" memory · Scope: Large
**Not blocked by shadow data.** This is the half of W3 that does not need the salience distribution — see "Why forgetting is not in this ticket" at the bottom.
**Files:** new `AIConsolidationService.ts`, `src/core/storage/localDb.ts` (new store), `src/features/ai/hooks/useEmbeddingIndexer.ts` (idle pass), reuse `AIFacetJudgeService` (judge pattern) and `AIBackgroundBudget` (governor).

## What this builds

Years of notes cannot live in a context window. Consolidation turns an unbounded history into a bounded, queryable layer: cluster nearby memory units → summarise the cluster into one stable **belief** carrying its evidence → the belief becomes what the AI knows and cites.

That last clause is exactly why the judge is mandatory. **A distortion introduced during summarisation becomes knowledge**, and the raw units it replaced are archived. This is the deepest risk in the whole MIND plan, and it is the reason this ticket exists in this shape.

## Tasks

1. **Belief store.** New IDB store (e.g. `aiBeliefs`): belief text, `evidence[{ id, date }]`, `firstSeenAt` taken from the earliest unit in the cluster, cluster size, `createdAt`, `judgeVerdict`. Additive upgrade only, `contains`-guarded, non-destructive — same shape as the `aiThemeLedger` (v16) and `aiInjectionJournal` (v17) upgrades, with the regression test that pre-existing data survives.

2. **Clustering (local, 0 LLM).** Group nearby memory units — chat memory, insights, timeline facts — by the vectors already stored in IDB. Clustering is by similarity; it does **not** need a salience threshold. Use salience only to decide *processing order* (most salient clusters first) so that a budget-capped run does the most valuable work.

3. **Summarise into a belief candidate (1 LLM call per cluster).** Produce one belief with `[#id · date]` evidence references and `firstSeenAt` from the earliest unit.

4. **Judge before publishing — the core requirement.** Every belief candidate is judged against its own evidence *before* it enters the queryable layer, following the existing `AIFacetJudgeService.review()` pattern (`AIFacetJudgeService.ts:114-143`): verdict → on failure one rewrite with a corrective hint → re-judge.
   - **Direction of failure is fail-open to the raw units.** A belief that does not pass is **not published**; its cluster stays as ordinary episodic units in the queryable layer. Memory degrades to a less-compressed but honest form — **never to an unverified generalisation.** Do not add a "publish anyway with low confidence" path.
   - The case the judge exists to catch: evidence says *"X иногда, но Y"* and the summary says *"пользователь считает X"*. The hedge must survive the compression.

5. **Run under the governor.** One background pass at tier P1 via `AIBackgroundBudget.canSpend()/spend()` in the existing idle orchestrator — the same route `processPendingThemeTouches` already uses. **Never on the chat path.** Budget: 2 LLM calls per cluster (summary + judge), 3 when a rewrite happens; a capped run simply processes fewer clusters and resumes next idle pass.

6. **Archive, do not delete.** Units absorbed into a published belief are marked archived, not removed. Beliefs are derived data — the note corpus is never touched, and a belief must be re-derivable from its evidence.

## Acceptance

- [ ] A cluster of related units produces one belief whose `firstSeenAt` equals the earliest unit's event date and whose evidence lists the source ids.
- [ ] **Distortion test (C2 seed):** a cluster whose evidence contains a hedged statement ("X иногда, но Y") must either keep the hedge in the belief or fail the judge. A belief asserting the unqualified "X" must not be publishable — survival is not enough, this test targets distortion, not loss.
- [ ] **Fail-open test:** when the judge rejects and the rewrite also fails, nothing is published and the cluster's units remain queryable.
- [ ] Repeated runs are idempotent — an already-consolidated cluster is not re-summarised.
- [ ] 0 LLM calls on the chat path; the pass stops cleanly when the governor budget is exhausted and resumes later.
- [ ] IDB upgrade additive; existing notes/summaries/ledger/journal intact after it.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, and **full** `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192` before pushing.

## Why forgetting is not in this ticket

W3's second phase — archiving units below a salience threshold — needs a **number on the real salience distribution**, and that distribution does not exist yet: the theme ledger has only been collecting since 0.7.62. Picking the threshold now would be guesswork, and a wrong one silently drops memory. Forgetting gets its own ticket once there is enough data to read the distribution — the same real-usage data the W2 shadow phase is collecting.

Consolidation without forgetting only grows the belief layer, which is safe in the short term; the pairing matters at scale, not at week one.

## Out of scope

Forgetting / archival thresholds, W4 self-model, W5 roll-ups, W7 proactive engine, the full C2 golden set (this ticket contributes the distortion case to it).
