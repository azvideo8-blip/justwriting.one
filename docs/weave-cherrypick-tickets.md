# WEAVE — cherry-pick tickets (July 2026)

Self-contained. Prefix: `WEAVE-`. Cherry-picked from the WEAVE design doc (`weave-write-back.md`) — **3 read-only, low-risk items only**. The write-back machinery and ambient/banner resurface are **deliberately deferred** (see closing note + memory). Owner reviews after.

**Why only these 3:** they deliver real value with **zero product risk and zero write-back contamination** — WEAVE-0 also closes audit finding AI-6 (no similarity floor in retrieval). The deferred WEAVE items either fight the "quiet distraction-free editor" product identity, risk AI-observations contaminating note bodies, rest on a now-stale premise, or need >1 user to mean anything.

## Guardrails (repo-specific)

- **0 new LLM on hot paths.** These are local vector-similarity + reads of already-computed `aiSummaries`. `findRelatedNotes` seed-by-docId uses cached IDB vectors (0 network); seed-by-text may do 1 infra `embed` (limit-exempt) — throttle it.
- **Lint per changed file** (`npm run lint` OOMs). Check dead/misplaced imports after extractions.
- **No note-body mutation.** These 3 are read-only display + a retrieval floor. Nothing writes into notes (that's the deferred WEAVE-4).
- **Reuse the `[#id · YYYY-MM-DD]` ref-tag format** for any note reference; don't invent a second.
- **Privacy:** any new data stays local (IDB), like memory. No Firestore sync without a separate decision.

**Order:** WEAVE-0 → WEAVE-6 → WEAVE-3 (WEAVE-6 depends on WEAVE-0; WEAVE-3 is independent).

---

## WEAVE-0 — Relevance floor in retrieval (closes AI-6) + `findRelatedNotes` 🔴

**Two parts. Part A is the actual AI-6 fix — do it in the real retrieval path, not only the new util.**

**Verified:** `src/features/ai/utils/noteRetriever.ts` — `searchNotes` builds RRF-fused candidates (`:194 topIds = fused.slice(0, RRF_FINAL)`), then either reranks or falls back (`:200,227,234`). There is **no absolute similarity floor**: `RERANK_THRESHOLD = 0.88` (`:22`) only decides *whether to rerank / trust exact-title* — top-K is returned regardless of how low the vector similarity is. So irrelevant notes enter the chat context and burn the ~25K-char budget (audit AI-6). `vectorMatches[0]?.score` is available at `:198`; per-candidate vector scores exist in the fusion inputs.

**Part A — add the floor to `searchNotes` (and `searchNotesMulti`):**
1. Introduce `RESURFACE_FLOOR` (start ~0.35, a named const). Drop candidates whose **best vector similarity** is below the floor — in **both** the rerank path and the fallback path (`fallbackIds`/`ids` at `:227-234`), so a low-similarity note never reaches the context. An empty result is valid (return `[]`, show nothing) — do not pad back up to `maxResults` with sub-floor notes.
2. Keep exact-title / exact-name short-circuits (they're intentional high-precision paths) — the floor applies to the *semantic* candidates.
3. Guard: a legitimately strong single match must still pass (don't over-filter). Tune the floor conservatively; log dropped-count in DEV to sanity-check.

**Part B — `findRelatedNotes` util (new `src/features/ai/utils/relatedNotes.ts`):**
1. `findRelatedNotes(seed: { text?: string; docId?: string }, opts) → RelatedNote[]`. `docId` → use the note's cached vectors from IDB (0 network). `text` → one `AIService.embed` (infra, limit-exempt; throttle callers).
2. Reuse the **same `RESURFACE_FLOOR`** + `vectorSearch.ts` (`topKMultiWithChunkIndex`, `cosineSimilarity`).
3. **MMR-lite dedup:** at most one chunk per note; penalize near-identical results.
4. **Filters:** exclude the seed note + current session; optional `minAgeDays` (surface old, not yesterday); recency tiebreak.
5. **Unit test the pure logic** (floor, MMR dedup, seed-exclusion) — also chips at audit ARCH-3.

**Budget:** 0 LLM for seed-by-docId; 1 infra-embed for seed-by-text. No background work.

**Acceptance:** in the chat, low-similarity notes no longer enter context (AI-6 closed — verify a query with no real match returns nothing, not filler); `findRelatedNotes` returns 3-5 relevant for a note with clear neighbors, `[]` for a unique note, never duplicates the seed; unit test green.

---

## WEAVE-6 — "See also" related-notes block (read-only, local) 🟡

**Depends on WEAVE-0.** Pure navigation — no mutation, no persistence, no confirmation.

**Context:** `findRelatedNotes({ docId })` (WEAVE-0); host in `src/features/archive/components/DocumentPreview.tsx` (the note preview).

**Tasks:**
1. When a note preview opens, compute top-K related via `findRelatedNotes({ docId })` (with the WEAVE-0 floor). Render a **"Связанные записи"** block: 2-4 items (title + date via the `[#id · date]` style), each clickable to open that note.
2. Empty when the note is isolated (floor → no block, not an empty header).
3. Light in-memory cache per docId for the session (invalidate on re-embed if easy; otherwise session-scoped is fine). **No IDB store, no persisted links** (that was the deferred WEAVE-4 "pin link" — skip it).

**Budget:** 0 LLM (cached vectors → cosine). **Risk:** low — read-only.

**Acceptance:** a note with clear neighbors shows a 2-4 item "Связанные записи" block; clicking opens the note; an isolated note shows no block.

---

## WEAVE-3 — Show existing AI enrichments as note metadata (read-only) 🔴

**Reduced from the original: display only, NO accept/reject** (accept/reject was WEAVE-4, deferred). This makes it a safe, cheap "make the already-computed data visible" ticket with no write-back.

**Verified:** `aiSummaries` (via `AISummaryService`) already stores `themes`, `insights`, `extractedFacts`, `commitments`, `tone` per note (from `functions/src/ai/summarizeDocument.ts`). Today they're only fuel for rerank/digests — the user never sees them on the note. Host: `DocumentPreview.tsx` (and optionally `GridNoteCard.tsx`/`NoteRow.tsx`, but preview first).

**Tasks:**
1. On the note preview, when an `aiSummaries` entry exists for the doc, show a **"Что заметил ИИ"** block: `themes` (as chips), a few `extractedFacts` / `insights`. Style them **visually distinct from user content** — clearly "AI observation", not a user-entered fact (muted, an icon, a "наблюдение ИИ" label).
2. **Read-only.** No accept/reject buttons, nothing written to the note body or tags. (The suggestion/accept layer is deferred WEAVE-4 — do NOT build it here.)
3. No block when there's no summary.

**Budget:** 0 LLM (IDB read). 0 Firestore writes.

**Acceptance:** opening a note with a summary shows its themes/facts/insights as clearly-labeled AI observations; no accept/reject controls; a note without a summary shows no block; nothing mutates the note.

---

### Deferred on purpose (NOT dropped) — reasons
- **WEAVE-1** (revive the chat resurface banner): premise is **stale** — the commented banner skeleton was deleted in AUD-6. No longer a cheap "revive"; would be a rebuild. Reconsider only if the banner is wanted again.
- **WEAVE-2** (ambient resurface *during* writing): fights the "quiet, distraction-free editor" product identity — showing "you wrote this before" mid-flow interrupts the flow the product protects. If ever built: default-OFF flag.
- **WEAVE-4 / WEAVE-5 / WEAVE-7** (suggestion queue + write-back of tags/links/facts/follow-ups into notes): **contamination risk** — accepted AI observations written into note bodies re-feed summaries/embeddings, so the AI cites its own guesses as the user's history, and the "observation not fact" label is lost after write. Needs a separate decision: keep accepted suggestions in a **separate metadata layer**, never mutate note bodies. Also plural IDB stores just before the Supabase migration = more to port.
- **WEAVE-8** (feedback-signal threshold tuning): meaningless at ~1 user; revisit under real usage.
Full design lives in the owner's `weave-write-back.md`.
