# AG-MIND-W2-cutover — migrate the live injections onto the assembler, block by block

**Priority:** P1 · the last step of W2 · Scope: Medium
**Depends on:** `docs/mind-w2-shadow-ticket.md` landed **and** its go/no-go bar met on real data.
**Files:** `src/features/ai/services/AIMemoryAssembler.ts`, `memoryFlags.ts`, `src/features/ai/hooks/useAIChatContext.ts`.

> **Do not start this ticket on shadow numbers that miss the bar.** If the median `overlapRatio` for a block is below 0.8, or anything from the mandatory band ever appeared in `wouldHaveDropped`, the answer is to calibrate floors/weights and re-measure — not to proceed with a lower bar. The bar was fixed before the data was collected precisely so it could not be moved afterwards.

## What this changes

Today `useAIChatContext` returns the live context as **separate fields** — `userPortrait` (every turn, uncapped), `searchContext` (turn-1 proactive block), `memoryContext` (assembler output) — and each is injected on its own path. After this ticket every one of them is a *candidate* the assembler ranks and budgets, and `ff_memory_assembler_shadow` goes off.

This is a migration of working, user-visible behaviour. The portrait in particular is visible on **every single turn**, so a mis-scoring ranker is an immediately noticeable regression. Hence: one block at a time, verified in production between steps, portrait last.

## Order — strictly by blast radius

Flip **one** flag, ship, watch, then the next. Never two in one release.

1. **`ff_memory_assembler_chat_memory`** — already cosine-ranked today, so the assembler's ranking is closest to existing behaviour. Lowest risk, do it first.
2. **`ff_memory_assembler_retrieval`** — RAG/search context.
3. **`ff_memory_assembler_turn1`** — the proactive block; stops being a special case (it is currently a one-shot injection guarded by `recentContextInjectedRef`, so preserve "once per conversation" semantics through the candidate model, don't let it re-inject every turn).
4. **`ff_memory_assembler_portrait`** — **last**. Once live, the portrait stops being unconditional and uncapped: it competes, under a guaranteed floor (~600 chars per the plan) so it can be shortened but never silently vanish.

After each flip, before the next: re-read the journal aggregates on real turns and confirm nothing regressed. Rollback is flipping the one flag back — that is the whole point of the per-block design.

## Tasks

1. Make each flag actually switch its block between the legacy path and the candidate path (today they are declared but read nowhere — only `_shadow` is read).
2. Preserve per-block semantics through the migration — notably turn-1's once-per-conversation behaviour and the portrait's floor.
3. Keep the journal writing throughout: after cutover it is no longer a shadow instrument but the W8 "why do you know this" audit surface, so it must keep recording what was injected.
4. **Retire shadow only at the end:** once all four blocks are live and stable, `ff_memory_assembler_shadow` defaults to `false` and `legacyResult` construction can go. Not before — the legacy path is the rollback.

## Acceptance

- [ ] Each flag independently switches its block, and flipping it back restores the previous behaviour exactly (test per block).
- [ ] Mandatory band (crisis resources, attached note, persona) is never dropped at any budget — existing test stays green.
- [ ] Portrait, once cut over, still appears on every turn under its floor; it may be shortened, never omitted.
- [ ] Turn-1 block still injects once per conversation, not per turn.
- [ ] Global budget is never exceeded; `p90` usage stays within it.
- [ ] 0 new LLM/embedding calls on the chat path.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, **full** `npm run lint` (`NODE_OPTIONS=--max-old-space-size=8192`) before pushing.

## Out of scope

W3 (consolidation + belief judge + forgetting), W4 self-model, W8 C2 golden set. Those come after the assembler is the single injection path.
