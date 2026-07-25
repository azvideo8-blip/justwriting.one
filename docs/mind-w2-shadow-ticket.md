# AG-MIND-W2-shadow — make the shadow phase actually measurable

**Priority:** P1 · blocks the W2 cutover (and therefore W3) · Scope: Medium
**Files:** `src/features/ai/services/AIMemoryAssembler.ts`, `injectionJournal.ts`, `memoryFlags.ts`, `src/features/ai/hooks/useAIChatContext.ts`, `src/core/storage/localDb.ts`, diagnostics page.

## Why this ticket exists

A1 + W2 landed in 0.7.62: the two-band assembler, MMR ranking, the journal and the flags all exist and run on the real chat path (`useAIChatContext.ts:969`). But the shadow phase the roadmap requires — *"the assembler runs in parallel, the journal records what it WOULD have injected vs what actually was, compare on real sessions, calibrate"* — **cannot produce data today.** Three concrete gaps, all verified in the current code:

1. **The comparison baseline is wrong.** `legacyResult` (`AIMemoryAssembler.ts:243`) is built from `[legacyVoice, legacyFirstSeen, legacyQuote]` — the Stage-1 thin collector's own output. The *actual* live injections — `userPortrait` (returned separately from the hook, injected on every turn, uncapped) and the turn-1 `proactiveBlock`/`searchContext` — never enter the assembler at all. So the current `overlapRatio` compares W2 against a subset of itself, not against production behaviour.
2. **The live producers were never migrated to candidates.** `ff_memory_assembler_portrait` / `_turn1` / `_chat_memory` / `_retrieval` are declared but **read nowhere**; only `ff_memory_assembler_shadow` is read (line 264). The per-block cutover has no mechanism behind it yet.
3. **Nothing survives a reload.** `injectionJournal` keeps a module-level `journalBuffer`; `memoryFlags` keeps a module-level `currentFlags`. Both reset on every page load, there is no way to read the journal and no way to flip a flag.

Shadow mode itself is correctly wired and safe (`ff_memory_assembler_shadow` defaults to `true`, so `assembleMemoryContext` returns `legacyResult` and production output is unchanged). Keep that property throughout this ticket: **no user-visible change lands here.**

## Tasks

1. **Register the live producers as candidates (still shadow-only).**
   - Feed the real portrait and the turn-1 proactive block into the assembler as *competitive* candidates with their own categories, alongside the existing voice / first-seen / quote / RAG ones.
   - Build `legacyResult` from **what production actually injected this turn** (portrait + turn-1 block + the thin collector's lines), not from the thin collector alone — that is the only baseline that makes `overlapRatio` and `wouldHaveDropped` meaningful.
   - **Do not change what is injected.** With `_shadow` on, the hook must keep receiving exactly today's `userPortrait` / `searchContext` / `memoryContext` values. Assert this in a test.

2. **Persist the journal.** Move it off the module-level array into a capped IDB store (e.g. `aiInjectionJournal`, ~200 newest entries, ring-buffer eviction). Non-destructive upgrade only — bump v16 → v17 exactly like `aiThemeLedger` did, adding the store and nothing else, and keep the regression test that old data survives the upgrade. Writes must not block the chat path (fire into the governed background pass or a plain non-awaited write, but never a network call).

3. **Persist the flags** in `localStorage` so a flag survives reload and can be flipped without a rebuild — this is what makes the per-block cutover and its instant rollback real.

4. **Make the data readable.** Add a diagnostics view (the existing Diagnostics page) showing, over the stored entries: median/p90 `overlapRatio`, the `wouldHaveDropped` lines grouped by category, and per-turn budget usage. Aggregate numbers are the deliverable — the point is to answer "would the cutover regress anything", not to browse raw logs.

5. **Write the go/no-go bar into this doc before shadow data is collected** (see below) so it cannot be adjusted after seeing the results.

## Go / no-go bar — proposed, confirm or adjust before merging

Cutover of a block is allowed only when, over **≥100 real chat turns** with shadow on:

- **median `overlapRatio` ≥ 0.8** for that block's category — the assembler mostly agrees with production;
- **zero mandatory-band drops** — crisis resources / attached note / persona never appear in `wouldHaveDropped` (this must be structurally impossible; if it ever appears, it is a bug, not a threshold);
- **no dropped portrait turn while the portrait block is still pre-cutover** — i.e. the assembler never proposes evicting the portrait entirely on a turn where production showed it;
- **p90 budget usage ≤ the configured global budget** — no turn would have overflowed.

Failing any of these means calibrate floors/weights and re-measure, not proceed.

## Acceptance

- [ ] With `_shadow` on, the hook's returned `userPortrait` / `searchContext` / `memoryContext` are byte-identical to pre-change behaviour (regression test).
- [ ] `legacyResult` reflects production's actual injection set, not the thin collector's subset.
- [ ] Journal entries survive a page reload; store capped; v16 → v17 upgrade non-destructive (old notes/summaries intact).
- [ ] Flags survive a reload and can be flipped at runtime.
- [ ] Diagnostics shows median/p90 overlap, `wouldHaveDropped` by category, budget usage.
- [ ] Mandatory band still cannot be dropped under any budget (existing test stays green).
- [ ] 0 new LLM/embedding calls on the chat path.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, and **full** `npm run lint` — the last one needs `NODE_OPTIONS=--max-old-space-size=8192` and must be run before pushing (per-file linting let 4 violations reach CI last time).

## Out of scope

The cutover itself (flipping `_chat_memory` → `_retrieval` → `_turn1` → `_portrait`, in that order, portrait last) — that is the *next* ticket, gated on real shadow numbers meeting the bar above. Also out: W3 consolidation/forgetting, W4 self-model, W8 C2 golden set.
