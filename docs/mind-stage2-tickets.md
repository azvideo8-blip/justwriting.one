# MIND Stage 2 — tickets (A1, W2)

Stage 1 is done and shipped in 0.7.61 + follow-ups: W1 theme ledger, W4 lexicon/B3 gate, A2 thin candidate assembler (`AIMemoryAssembler`) wired into the chat prompt.

Stage 2 per the roadmap = **A1 salience → W2 full assembler → W3 consolidation+judge+forgetting → W4 self-model → W8 (guard/provenance/C2)**. Only the first two are ticketed here — see "Held" at the bottom for why.

**Standing rules for every ticket:** run `tsc` (both root and `functions`) and the **full** vitest suite, not just the new file — three separate false-greens so far came from skipping one of these. Lint changed files only (full lint OOMs). `firestore.rules` are covered only by the emulator suite, never by vitest.

---

## AG-MIND-A1 — `salience`: the shared importance currency

**Priority:** P1 · blocks W2 ranking and W3 forgetting · Scope: Small

**Context:** W1 already stores the *inputs* on `ThemeRecord` (`count`, `emotionalWeight`, `lastReinforcedAt`) — see `src/core/storage/localDb.ts` and `AIThemeLedgerService`. The score function itself was never built. Nothing can rank or forget until it exists.

**Design (fixed by the plan — implement as specified, do not redesign):**
```ts
salience = w_r · exp(−Δt / τ)                       // recency ∈ [0,1]
         + w_f · log(1 + count) / log(1 + F_cap)     // frequency ∈ [0,1], log-damped
         + w_e · emotionalWeight                     // ∈ [0,1], already normalised
```

**Tasks:**
1. New `salienceConfig.ts` holding **all** constants with documented defaults: `τ ≈ 90 days`, `F_cap ≈ 10`, weights `w_r / w_f / w_e`. The knobs are the whole design — no magic numbers inline.
2. Pure `computeSalience(inputs, now)` — **compute lazily at ranking time**, never persist a score (recency must always be fresh; zero staleness, zero background recompute passes).
3. `emotionalWeight` is already `clamp01(max(|valence|, arousal))` from W1 — reuse, don't recompute.
4. Keep `count` raw in storage (honest "you wrote about this 50 times"); the log damper applies **only** to ranking.

**Acceptance:**
- [ ] Pure function, no I/O, no network; deterministic for a fixed `now`.
- [ ] All three terms provably ∈ [0,1]; total ordering behaves as expected across the knobs.
- [ ] **Rumination test (C2 seed):** 20 anxious notes on one theme + 1 pivotal insight → the insight must rank above the ruminative cluster. This is the calibration test for the weights — if it fails, tune the config, not the formula.
- [ ] Recency decay test: same `count`/`emotionalWeight`, older `lastReinforcedAt` ranks lower; half-life matches `τ`.
- [ ] `tsc` 0 (root + functions), full vitest suite green, lint clean.

**Out of scope:** consumers (W2 ranking, W3 threshold, W5 roll-up selection) — they land in their own tickets. Ship the primitive plus tests only.

---

## AG-MIND-W2 — full memory assembler + shadow-mode cutover

**Priority:** P1 · Stage-2 keystone · Scope: Large · **Depends on A1**

**Context:** `AIMemoryAssembler` today is the *thin* Stage-1 collector (voice + first-seen/quote, fixed caps, no ranking). W2 turns it into the real assembler and **migrates the currently-live injections** onto it: the portrait (injected always, uncapped, `useAIChatContext.ts` ~965), the turn-1 proactive block (~812–962), and chat memory. This is a migration of working, user-visible behaviour — a mis-scoring ranker is a visible regression.

**Design:**
1. **Two bands.**
   - *Mandatory* (never ranked, never dropped): crisis resources, the explicitly attached note, persona instructions.
   - *Competitive* (ranked): self-model snippet, lexicon map, first-seen lines, quotes, retrieval notes, graph facts, roll-ups.
   - Rationale is a hard requirement: the lexicon must never be able to evict a crisis hotline.
2. **Floors and caps per category** — small blocks get a guaranteed floor (lexicon ~200 chars, self-model ~600), the rest fill competitively under the global budget. A pure global score would let notes swallow everything on an emotional day.
3. **Ranking:** `sim × salience × diversity` (MMR-style, kills near-duplicates). `salience` comes from A1.
4. **Injection journal:** log what got injected this turn. This is simultaneously the W8 audit surface ("why do you know this") and the shadow instrument below — build it once.

**Rollout — shadow-mode only, big-bang is forbidden:**
1. **Define the go/no-go bar BEFORE starting shadow** (overlap@budget threshold + acceptable would-have-dropped set). Writing the bar afterwards is moving the goalposts.
2. **Shadow phase:** assembler runs in parallel, changes nothing in prod; the journal records "what it *would* have injected" vs "what actually was". Compare on real sessions, calibrate floors/weights.
3. **Cutover block-by-block, ordered by blast radius:** chat memory first (already cosine-ranked, lowest risk) → lite retrieval → turn-1 block → **portrait last** (it is visible on every single turn today; any mis-scoring is instantly noticeable).
4. Feature flag `ff_memory_assembler` with per-block instant rollback.

**Acceptance:**
- [ ] Mandatory band is never dropped under any budget pressure (test with a deliberately tiny budget).
- [ ] Category floors honoured; global budget never exceeded.
- [ ] MMR removes near-duplicate candidates.
- [ ] Shadow journal produces the comparison metrics; the go/no-go bar is written down before any cutover.
- [ ] Each block can be flipped and rolled back independently via the flag.
- [ ] 0 new LLM/embedding calls on the chat hot path.
- [ ] `tsc` 0 (root + functions), full vitest suite green, lint clean.

**Out of scope:** consolidation/judge (W3), self-model (W4 half 2), C2 golden set (W8).

---

## Held deliberately — not ticketed yet

- **W3 (consolidation + belief judge + forgetting)** — the forgetting threshold is a *number on the salience distribution*. That distribution doesn't exist until A1 ships and runs on real notes. Ticketing it now means guessing the cutoff and rewriting the ticket.
- **W4 self-model (half 2)** — sits on top of the assembler's candidate model; its injection shape depends on what W2's floors/caps turn out to be.
- **W8 (guard / provenance / C2 golden set)** — the C2 fixture must encode the rumination case with A1's *actual* weights and the distortion case against W3's *actual* consolidation output. Written earlier, it tests fiction.

Ticket these once A1 has run on real data and W2's shadow phase has produced numbers.
