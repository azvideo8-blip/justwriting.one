# AG-MIND-W3-clustering — cluster beliefs by meaning, not by shared words

**Priority:** P1 · do this **before** any bulk run over the note backlog · Scope: Small
**Files:** `src/features/ai/services/AIConsolidationService.ts` (`clusterMemoryUnits`), reuse `cosineSimilarity` from `src/features/ai/utils/vectorSearch`.

## The problem

`clusterMemoryUnits` groups memory units with `textJaccardSimilarity` — literal word overlap, threshold 0.35. Two units about the same thing in different words never cluster:

- «не могу заставить себя начать»
- «опять залип и потерял день»

Obviously one theme to a human; zero shared content words to Jaccard. So they stay separate episodic units and never consolidate into a belief.

The roadmap specified clustering by the vectors already stored in IDB, and those embeddings exist (`aiEmbeddings`, plus `themeVector` on ledger records). Consolidation is the one place that ignores them.

## Why the timing matters

The backlog is the argument for fixing this first. A bulk pass over the existing notes with word-overlap clustering would spend the daily governor budget producing few, poorly-grouped beliefs — and each published belief marks its units consolidated, so re-running later with better clustering would find that material already claimed. **We would bake in the weaker result.** Cheap now, expensive after.

## Task

1. Cluster on embeddings: pull the vector for each memory unit and compare with `cosineSimilarity` instead of `textJaccardSimilarity`.
2. Vectors come from what is already stored — do **not** add embed calls to make this work. If a unit has no vector available, fall back to the current text similarity for that unit rather than calling out to the network; consolidation must stay 0-network on its own path (it already spends LLM calls on summary+judge, that is the budget).
3. Re-tune the threshold for cosine — 0.35 is a Jaccard number and means something completely different on cosine similarity. Pick it from real data: cluster a sample of existing units at several thresholds and look at what groups.
4. Keep everything else as is — salience ordering, governor budget, judge, fail-open.

## Acceptance

- [ ] Two units expressing the same idea in different words cluster together (the «залип» / «не могу начать» case, as a test with fixed vectors).
- [ ] Two units sharing words but not meaning do **not** cluster.
- [ ] No new embedding or network calls on the consolidation path (assert call counts in a test).
- [ ] Units without a stored vector still work via the text fallback.
- [ ] The chosen threshold is a named constant with a comment saying what data it was picked from.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, **full** `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192`.

## Out of scope

A3 forgetting, enabling `ff_memory_assembler_beliefs`, the extraction-prompt rework.
