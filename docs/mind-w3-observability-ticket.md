# AG-MIND-W3-obs — make the judge observable, and record what it rejects

**Priority:** P1 · W3 is deployed but unobservable · Scope: Small-Medium
**Files:** `src/features/ai/services/AIConsolidationService.ts`, new `BeliefsDiagnostics.tsx`, `src/features/ai/pages/DiagnosticsPage.tsx`.

## Why this is more than "add a UI"

W3 now runs in production, and **nothing about it can be seen.** There is no diagnostics view, so beliefs are only visible by opening DevTools → IndexedDB → `aiBeliefs`.

Worse, the number that actually matters is not recorded anywhere. Rejected candidates are dropped on an early return (`AIConsolidationService.ts:273`) and never written, so `aiBeliefs` contains only `PASSED` and `REWRITTEN_PASSED`. **The reject rate is invisible** — and that single ratio is the only way to tell whether the judge is calibrated:

- rejecting almost everything → memory never consolidates, and the "infinite memory" payoff silently never arrives;
- rejecting almost nothing → the judge is decorative and distortions are being published as knowledge.

Both failure modes look identical from outside today: some beliefs exist, and that's all we know. (A leftover `if (b.judgeVerdict !== 'REJECTED')` filter at line 85 assumes rejected rows are in the store — they never are. Dead condition, and a hint the gap was unintentional.)

## Tasks

1. **Record rejections — but keep them out of `aiBeliefs`.** Log each rejected candidate (timestamp, cluster size, `firstSeenAt`, the judge's reason, whether a rewrite was attempted, and a short excerpt of the rejected text) to a separate capped store or the existing journal-style ring, **not** to `aiBeliefs`.
   Keep the invariant **"`aiBeliefs` = beliefs the AI may use"**. Storing rejected candidates there behind a verdict filter would work today only because nothing reads beliefs yet (see below) — and the first reader that forgets the filter would inject exactly the distortion the judge caught. Don't set that trap.

2. **Diagnostics tab** next to «Сборщик памяти» (same wiring as `MemoryAssemblerDiagnostics`, `DiagnosticsPage.tsx:258/646`), showing:
   - published vs rejected counts and the reject rate;
   - the split `PASSED` / `REWRITTEN_PASSED` — a high rewrite share means the first-pass prompt is systematically overreaching;
   - recent rejections with their reasons — the actual material for tuning the prompt;
   - published beliefs with their evidence and `firstSeenAt`, so a wrong belief can be traced to the units it came from.

3. **Keep it read-only.** No editing or deleting beliefs from this view — that is memory-management UI, a separate concern.

## Acceptance

- [ ] A rejected candidate is recorded with its reason and is **not** present in `aiBeliefs`.
- [ ] Diagnostics shows published/rejected counts, reject rate, PASSED vs REWRITTEN_PASSED split, and recent rejection reasons.
- [ ] Published beliefs are listed with evidence ids and `firstSeenAt`.
- [ ] The rejection log is capped and does not grow without bound; it is cleared on sign-out with the other per-user stores.
- [ ] Fail-open is unchanged: a rejected belief still is not published and its units stay queryable.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, **full** `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192` before pushing.

## Related gap — not this ticket

**Nothing reads beliefs back.** `getAllBeliefs` is called only inside `AIConsolidationService` itself (for dedup); no assembler category, no prompt path consumes them. Consolidation is currently **write-only**: it compresses memory into beliefs that never reach a conversation, so the user cannot yet feel any of it. Wiring beliefs into the assembler as a candidate category is its own ticket and should come after this one — deciding what to inject is much easier once we can see what the judge is actually publishing.

## Out of scope

Belief injection into the prompt, A3 forgetting, C1 sensitivity, the C2 golden set.
