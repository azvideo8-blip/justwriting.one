# Memory Trust & Consent — Tickets (July 2026)

Self-contained. Prefix: `MEM-`. Goal: put a **trust/consent skin** over the memory features that already ship, so the AI never silently "knows everything" — it shows *what* it remembers, *where* it got it, and lets the user say "no, that's not me."

**Product north-star (read first):** the AI must behave like an attentive interlocutor with a good memory, not an omniscient profiler. Every factual claim from notes carries its source (note id + date + excerpt). Inference is labelled as observation, not fact. The user can open, exclude, or correct any source.

## Reconciliation — most of the "memory features" already exist (do NOT rebuild)

A separate MEMORY-0..9 draft was scoped against the code. Result: **6 of 9 are already shipped** under SEAM names. Do not re-implement these:

| Draft feature | Already shipped as |
|---|---|
| Period recap ("что было в июле") | `temporalQueryParser` (month/dateRange) → `useAIChatContext.ts` ~L190–224 → `AITimelineService.getByMonth/getByDateRange` + `AIMonthlyDigestService` |
| Relationship mentions | `temporalQuery type:'person'` → `AIPeopleService.search` (`useAIChatContext.ts` ~L247–266) + name-case normalization |
| Evolving themes / arcs | `AIThreadService.ts` (SEAM-5) |
| Open loops / intentions | `AICommitmentService.ts` (SEAM-4) + `commitments` in `functions/src/ai/summarizeDocument.ts` |
| Resonance after writing | `echo` field in `summarizeDocument.ts` → `WritingFinishModal.tsx` (SEAM-9) |
| Pattern / divergence | SEAM-8 contradiction seed (local) |

**The real, un-built delta is these tickets:** grounded citations (MEM-0), scope UI + hard-scoped retrieval (MEM-1), consent-based people resolution (MEM-2), correction loops (MEM-3), decision-outcome journal (MEM-4, net-new P2).

## Validated up front: model self-citation is reliable

A faithfulness harness (`scripts/ai/citation_faithfulness.mjs`, landed in MEM-0) fed the active model (`deepseek/deepseek-v4-flash`) a small corpus + a strict `[#id]` contract, including trap questions with no supporting note. Result: **6/6, zero fabricated citations, all traps correctly refused.** So MEM-0 leans on the model emitting `[#id]` markers — **no heavier programmatic-grounding architecture is required as a prerequisite**. A cheap defensive guard (strip `[#id]` whose id was not in the injected context) covers noisier real corpora.

## Guardrails for every ticket (repo-specific — do not skip)

- **Lint per changed file, not the whole repo.** `npm run lint` OOMs here; lint only touched files. Extractions/moves in this codebase repeatedly leave dead or misplaced imports — check them.
- **No fire-and-forget AI calls from hot paths** (a chat turn, the writing session). Any new background LLM work goes through the SEAM-0 budget governor (`AIBackgroundBudget`). MEM tickets add **no** new per-turn LLM cost unless a ticket says so.
- **IDB migrations are additive/optional.** One version bump per ticket that adds a store (SEAM-1 targeted 12→13; use the next free version). New fields optional, no index unless needed. See `[[sw-indexeddb-staleness]]`.
- **On release, bump `CACHE_VERSION` in `public/sw.js`** to match the package version (asset eviction).
- **Grounding prompt must not double-instruct reasoning markers.** The active model handles `ХОД МЫСЛИ`/`ОТВЕТ` framing itself; the `[#id]` contract is orthogonal — do not entangle it with reasoning-mode instructions (see `[[reasoning-mode-deepseek]]`).

**Implementation order:** MEM-0 → MEM-1 → MEM-2 → MEM-3 → MEM-4.

**Priority key:** 🔴 foundational · 🟡 solid value · 🟢 later.

---

## MEM-0 — Grounded citations in chat answers 🔴

**Context:** `src/features/ai/hooks/useAIChatContext.ts` (context assembly), `src/features/ai/utils/noteRetriever.ts` (`RetrievedNote` at L9 already carries `documentId`, `title`, `content`), `src/features/ai/hooks/useAIChat.ts` (system message assembled ~L138), `src/features/ai/pages/AIPage.tsx` (assistant render via `MarkdownRenderer` at ~L501), `src/shared/ai/prompts.ts` + `functions/src/shared/prompts.ts` (`PERSONA_PROMPTS`), `api/chat.ts` (active model).

**Why:** this is the trust foundation everything else stands on. Today the chat pulls relevant notes but the answer cites nothing — the user cannot tell what is grounded vs invented. Validated that the model self-cites faithfully, so this is wiring, not a new engine.

**Tasks:**
1. **Ref-tag injected notes.** In `useAIChatContext.buildContext`, when injecting retrieved notes / temporal blocks into context, prefix each with a stable ref header: `[#<documentId> · <YYYY-MM-DD>]`. Keep the full text after it. Track the set of injected ids for the turn (for the guard in step 4).
2. **Citation contract in the prompt.** Append to the persona/system prompt (both `src/shared/ai/prompts.ts` and `functions/src/shared/prompts.ts`, and the base system prompt in `api/chat.ts` if separate): *every factual claim taken from the notes ends with its source `[#id]` (multiple allowed: `[#a][#b]`); never cite an id not present in the provided notes; if the notes don't answer, say so plainly and cite nothing; label anything you infer as an observation ("судя по заметкам…"), not a fact.* Keep it short; do not touch reasoning-marker instructions.
3. **Render source chips.** In `AIPage.tsx`, post-process assistant `msg.content` before/inside `MarkdownRenderer`: turn each `[#id]` token into a clickable chip showing the note date; click opens/previews that note. Unknown ids (shouldn't happen after the guard) render inert, not as raw text.
4. **Defensive guard.** After generation, drop or neutralize any `[#id]` whose id was not in the turn's injected set. Cheap belt-and-suspenders; the model tested clean but real corpora are noisier.
5. **Land the harness as a regression test.** Move `scratchpad/citation_faithfulness.mjs` → `scripts/ai/citation_faithfulness.mjs` (or a `functions/src/ai/__tests__` variant gated on `OPENROUTER_API_KEY`). Keep the trap questions. It runs manually / in a nightly, not on every PR (needs a live key).

**Budget note:** 0 extra LLM (rides the existing chat turn). No background work.

**Acceptance:** ask a memory question → the answer shows clickable source chips that open real notes with correct dates; a question with no supporting note yields "в записях об этом ничего нет" and zero chips; a claim the model infers is phrased as an observation; the guard strips any out-of-context id; the harness passes against the active model.

---

## MEM-1 — Visible, removable memory scope + hard-scoped retrieval 🔴

**Context:** `src/features/ai/utils/temporalQueryParser.ts` (`TemporalQuery`: `month | dateRange | recent | person | none`), `src/features/ai/hooks/useAIChatContext.ts` (temporal branch ~L190–266; general retrieval path below it), `src/features/ai/pages/AIPage.tsx` (chat UI). Depends on MEM-0 (scope must bound what gets cited).

**Why:** `parseTemporalQuery` already detects a scope and scopes the *digest text block*, but (a) the scope is invisible and can't be removed, and (b) the **general note-retrieval path is not filtered** to the scope — so "поговори со мной только про февраль" still pulls notes from any month into ranking. Trust requires the boundary be visible and real.

**Tasks:**
1. **Visible scope chip.** When `parseTemporalQuery` returns a `month`/`dateRange`, render a removable chip in the chat header ("Только февраль 2026 ✕"). One click clears it and returns to unscoped retrieval. Persist the active scope for the dialogue until cleared.
2. **Hard-scope the retrieval candidate set.** When a scope is active, filter note candidates to `date ∈ [from,to]` / `month` *before* ranking in the note-search path (not just the digest block). Reuse the date already on `aiTimeline` / summary records; don't add a query.
3. **Comparison mode.** When the user asks to compare two periods ("весна vs осень"), retrieve each scope separately and label the two blocks distinctly in context so the model doesn't blend them.
4. **Insufficient-material honesty.** If a scope yields too few notes, inject a marker so the persona says so ("за этот период мало записей — …") instead of confabulating.

**Budget note:** 0 LLM (embed-only retrieval, already exempt). +1 embed per turn max, unchanged.

**Acceptance:** "только февраль" shows a removable chip, retrieval returns only February notes (verify via the injected context), one click clears it; comparison keeps the two periods separate; an empty scope produces an explicit "мало материала", never invented events.

---

## MEM-2 — Consent-based people resolution 🟡

**Context:** `src/features/ai/services/AIPeopleService.ts` (today only `search`; no merge), `src/features/ai/utils/temporalQueryParser.ts` (person branch), `localDb.ts` (IDB). Depends on MEM-0.

**Why:** the writer refers to one person many ways ("Саша", "Александр", "брат"). Silently merging identities is the single worst trust break; never asking means person-timelines stay fragmented. The system should *suspect and ask*, never auto-merge.

**Tasks:**
1. **Alias store.** New IDB store `aiPersonAliases` (one version bump): `{ canonicalId, labels: string[], confirmed: boolean, createdAt, dismissed?: boolean }`. Per-account, local — no server, no cross-user data.
2. **Suggestion, not merge.** A local heuristic (co-occurrence + embedding proximity of the surrounding note context, reusing the chat-memory dedup cosine pattern) proposes that two labels *might* be one person. Emit a **suggestion** into a lightweight review surface — never mutate identity silently.
3. **Consent UI.** For each suggestion: **confirm / reject / rename / undo**. Undo restores the exact prior state. Rejected/dismissed pairs don't resurface.
4. **Confirmed-only resolution.** The person retrieval path (`temporalQuery type:'person'` → `AIPeopleService.search`) resolves across labels **only** for `confirmed` alias sets by default. Unconfirmed stays split.

**Budget note:** 0 LLM (detection is local: names + existing embeddings).

**Acceptance:** two labels for one person surface a suggestion (not a silent merge); confirming links them and the person timeline then spans both labels; reject/undo revert cleanly and don't nag; unconfirmed labels stay separate.

---

## MEM-3 — Correction loops: exclude a source, fix a mention 🟡

**Context:** `AIPage.tsx` (source chips from MEM-0; person surfaces from MEM-2), `useAIChatContext.ts`. Depends on MEM-0, MEM-2.

**Why:** grounding without a correction path is still one-directional "the AI decides". Letting the user push back is the other half of trust.

**Tasks:**
1. **Exclude a source.** On a MEM-0 source chip, offer "исключить из этого ответа" → re-run synthesis for that turn with the note removed from context (or, minimally, visibly strike it and instruct the model to disregard it). The answer must visibly change.
2. **Fix a mention.** On a person mention / person-scoped result, offer "это не тот человек" → detach that note from the person's alias set (feeds MEM-2's store, respecting confirm/undo). 
3. Keep both actions local and reversible; no new LLM call beyond the single re-synthesis in (1), which is a normal chat turn.

**Acceptance:** excluding a source re-grounds the answer without that note; correcting a mention updates the alias mapping and the next person query reflects it; both are undoable.

---

## MEM-4 — Decision-outcome journal 🟢 (P2, net-new)

**Context:** `AICommitmentService.ts` (SEAM-4), `AIThreadService.ts` (SEAM-5), `functions/src/ai/summarizeDocument.ts` (summary schema), `useAIChatContext.ts`. Depends on MEM-0.

**Why:** the only genuinely new *feature* in the draft — help the writer learn from their own decisions ("как обычно оборачивались мои решения о работе"). Must connect deliberation → stated decision → later reflection **without** claiming causation.

**Tasks:**
1. **Reuse, don't add a call.** Derive decisions locally from existing signals: a note flagged as a choice/commitment (SEAM-4 `commitments`) linked to later reflection notes by embedding proximity + time order (SEAM-5 thread machinery). If a dedicated field is truly needed, piggyback one optional `decisions: string[]` on the existing summarize schema — never a new LLM call.
2. **Group & cite.** For a decision query, group each decision with its prior context and later follow-ups; every claimed outcome carries dates + MEM-0 source excerpts.
3. **Correlation ≠ causation.** Label outcomes as correlation, explicitly not causal ("после этого решения в заметках — …", not "решение привело к…").
4. **Correctable grouping.** Let the user mark a decision as unrelated / misgrouped (feeds back like MEM-3).

**Budget note:** 0 extra LLM if extraction rides SEAM-1; grouping is local.

**Acceptance:** "как обычно оборачивались мои решения о работе" returns grouped decision→outcome sets, each claim cited with dates, correlation labelled distinctly from causation, and a misgrouped decision is user-correctable.

---

## Why this won't eat the budget

Every ticket is either **0 LLM** (local detection / embed-only retrieval / rides an existing turn) or bounded by the SEAM-0 governor. MEM-0's only "cost" is prompt tokens for the citation contract + ref headers — bounded by the existing context char caps. The trust layer is a skin over shipped machinery, not a second AI pipeline.
