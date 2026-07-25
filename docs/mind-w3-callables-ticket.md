# AG-MIND-W3-callables — the two Cloud Functions consolidation calls but that do not exist

**Priority:** P0 for W3 · **W3 consolidation cannot work in production without this** · Scope: Medium
**Files:** new `functions/src/ai/summarizeBeliefCluster.ts`, new `functions/src/ai/judgeBeliefCandidate.ts`, `functions/src/index.ts`.

## The gap

`AIConsolidationService` (landed client-side) calls two callables:

```ts
httpsCallable(functions, 'summarizeBeliefCluster')   // AIService.ts:229
httpsCallable(functions, 'judgeBeliefCandidate')     // AIService.ts:258
```

**Neither exists.** `rg 'summarizeBeliefCluster|judgeBeliefCandidate' functions/src/` returns nothing, and `functions/src/index.ts` exports 15 callables, none of them these. Every consolidation attempt in production fails with `functions/not-found`; the unit tests pass only because they mock `AIService`.

Client-side behaviour on failure is safe — `AIService` catches, reports a warning and returns `{ ok: false }`, so consolidation degrades to a no-op rather than crashing. A related budget-accounting bug (the governor was charged *before* the call, so a dead callable would have drained the whole shared 60-unit daily budget and starved threads / digests / portrait / facet work) is already fixed: the governor is now charged for calls that actually happened.

So the tree is safe to ship — **but W3 does nothing until these two functions exist.**

## Tasks

Model both on the existing pair `functions/src/ai/summarizeFacet.ts` and `functions/src/ai/judgeFacets.ts` — same skeleton, same guards, same accounting.

1. **`summarizeBeliefCluster`** — input `{ evidence: [{ id, date, snippet }], firstSeenAt, correctionHint? }` → output `{ belief: string }`.
   - Prompt: compress the evidence into ONE stable belief in the user's language. **Hedges and conditions must survive** ("X иногда, но Y" must not become "X") — this is the property the judge exists to enforce and the prompt should not fight it.
   - `correctionHint` is the rewrite path: when present, the prompt must take it as a correction of the previous attempt.
   - Every evidence snippet is user text → `hasInjectionAttempt` on it, `sanitizeAiInput` before the prompt, `sanitizeAiResponse` on the way out.

2. **`judgeBeliefCandidate`** — input `{ belief, evidence[] }` → output `{ passed: boolean, reason: string, correctiveHint?: string }`.
   - Verdict is **against the evidence only** — does the belief overstate, drop a qualifier, or assert something the evidence does not support?
   - Return a strict, parseable verdict (the SEC-25 lesson: no `startsWith`-style loose parsing — a strict JSON shape, and anything unparseable counts as **not passed**).
   - `correctiveHint` should say what to fix, since the client feeds it straight back into the rewrite.

3. **Guards and quotas on both** (copy from `summarizeFacet`/`judgeFacets`):
   - `enforceAppCheck: true` — every other callable uses the hard `true`, not an env-conditional.
   - auth required; zod schema with sane caps on evidence count and snippet length.
   - `hasInjectionAttempt` on all user-derived text **before** the bulk-limit increment (matching the fix already made to the other AI functions — a rejected request must not burn quota).
   - bulk-limit + `tryReserveGlobalRequest` + refund on failure; `recordUsage` on success.
   - Use the shared `getDb()` accessor if any Firestore access is needed — a bare `getFirestore()` targets `"(default)"`, a different empty database (this bit `sendTelemetry`).

4. **Export both from `functions/src/index.ts`** and deploy — client calls will keep failing until `firebase deploy --only functions` runs.

## Acceptance

- [ ] Both callables exist, are exported, and the client's existing `AIService` methods reach them unchanged (no client edits needed).
- [ ] Injection attempt in evidence or belief → rejected **before** any quota is consumed.
- [ ] Judge returns a strict verdict; unparseable output is treated as **not passed** (fail-open to raw units, never a silent pass).
- [ ] The hedge case: evidence "X иногда, но Y" + candidate "пользователь считает X" → judge returns `passed: false` with a usable `correctiveHint`.
- [ ] Unit tests in `functions/src/ai/__tests__/`, mirroring the `judgeFacets` tests.
- [ ] `tsc` 0 (root + functions), full vitest both sides, **full** `npm run lint` (`NODE_OPTIONS=--max-old-space-size=8192`).
- [ ] After deploy: one real consolidation pass publishes a belief, verified in the Diagnostics/IDB.

## Note for whoever picks this up

The client contract is already fixed by `AIService.summarizeBeliefCluster` / `judgeBeliefCandidate` (`src/features/ai/services/AIService.ts:223-292`) — match those input/output shapes exactly rather than redesigning them, or the client needs changing too.
