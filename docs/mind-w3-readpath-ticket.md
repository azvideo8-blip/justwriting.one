# AG-MIND-W3-readpath — let beliefs reach the conversation

**Priority:** P1 · closes the W3 loop — everything is produced and stored, nothing is consumed · Scope: Medium
**Files:** `src/features/ai/services/AIMemoryAssembler.ts`, `memoryFlags.ts`, `src/features/ai/hooks/useAIChatContext.ts`, `src/features/ai/utils/dateGuard.ts`.

## Why

W3 is live: clusters are consolidated, judged, and published to `aiBeliefs`. But `getAllBeliefs` is called **only inside `AIConsolidationService` itself**, for dedup. No assembler category, no prompt path reads beliefs.

Consolidation is therefore **write-only**: it compresses memory into a form nothing consumes, so the user feels nothing from any of it. This ticket connects the last pipe — and it is where the "infinite memory" payoff finally shows up, because a belief is exactly the compact, dated, evidence-backed statement the assistant should be able to lean on years later.

## Tasks

1. **New `belief` category, competitive band.** Add `'belief'` to `MemoryCandidateItem['category']` and register published beliefs as competitive candidates with a floor (~400 chars — enough for one belief and its citation, small enough that it cannot squeeze out retrieval).

2. **Only publishable beliefs, ever.** Feed candidates from `getAllBeliefs()` filtered to `judgeVerdict !== 'REJECTED'` and `isArchived !== true`. Rejected candidates live in `aiBeliefRejections` and must never be read from here — that separation is the whole point of the fail-open design.

3. **Carry the evidence.** A belief without its sources is an unfalsifiable claim, which is what this whole layer exists to avoid. Inject each belief with its `[#id]` evidence references so the existing citation guard (`sanitizeCitations`) applies and the user can trace the claim back to the notes it came from.

4. **Salience inputs.** Rank beliefs with the shared currency, not a bespoke score: `count` = `clusterSize` (how much evidence backs it), `emotionalWeight` from the underlying units if available, `lastReinforcedAt` = `updatedAt`. A belief backed by twelve units should outrank one backed by two.

5. **Own feature flag** `ff_memory_assembler_beliefs`, default **false**, following the same discipline as the other blocks: land dark, watch the injection journal, then enable. Do not switch beliefs on in the same change that adds them.

6. **⚠️ Interaction with the W8(a) date guard — check this explicitly.** The guard collects its allowed dates by re-parsing rendered lines that contain the word «впервые» plus an ISO date (`extractFirstSeenDates`). Beliefs carry `firstSeenAt`, so if a belief line states a first-seen date in a format the extractor does not recognise, the guard will **strip that date from the reply** — silently deleting correct information.
   Either render belief lines so the extractor picks their dates up, or extend the extractor to cover them. **Add a seam test** like the existing one in `AIMemoryAssemblerShadowCutover.test.ts`: run the real assembler with a belief and assert `extractFirstSeenDates` finds its date.

## Acceptance

- [ ] With the flag on, a published belief reaches the system prompt with its `[#id]` evidence intact.
- [ ] Rejected and archived beliefs are never injected (test both).
- [ ] Beliefs compete under a floor: a large retrieval block cannot evict them entirely, and a belief cannot evict the mandatory band.
- [ ] Ranking uses `computeSalience` inputs, so a better-evidenced belief outranks a thin one.
- [ ] Flag defaults to false; with it off, output is byte-identical to today (regression test).
- [ ] **Seam test:** a belief's `firstSeenAt` survives the date guard — it is not stripped from replies.
- [ ] 0 new LLM/embedding calls on the chat path.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, **full** `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192` before pushing.

## A judgement call worth making deliberately

Beliefs and the theme ledger (`first_seen`, `quote`) can describe the same material — a belief is the compressed form of units a theme also points at. Injecting both risks telling the model the same thing twice in different words, which wastes budget and can read as the assistant repeating itself.

Prefer letting MMR diversity handle it rather than hard-coding precedence: they are separate candidates with genuinely different text, and the ranker exists for exactly this. But watch the injection journal after enabling — if beliefs and first-seen lines routinely co-occur for the same theme, revisit.

## Out of scope

A3 forgetting, C1 sensitivity, W4 self-model, the C2 golden set. Enabling the flag in production is a separate step, gated on the journal showing beliefs rank sensibly.
