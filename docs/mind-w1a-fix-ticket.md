# AG-MIND-W1a-fix — remove embed-storm from write-path + transaction

**Priority:** P1 · **blocks merge of W1a** · Scope: Medium
**Files:** `src/features/ai/services/AIThemeLedgerService.ts`, `src/features/ai/services/AISummaryService.ts`, idle orchestrator `src/features/ai/hooks/useEmbeddingIndexer.ts`.

**Context (from my review of W1a):** `touchThemes` calls remote `AIService.embed` (→ `httpsCallable('embedDocument')`) per theme, `await`ed inside `AISummaryService.save()` which runs per note. A bulk re-summarization (model change) → M×N remote embed calls — the exact uncapped-embedding-resync pattern that already caused a Firestore write-quota incident. Also: `getAll → mutate → put` with no transaction = lost `count` updates under concurrent saves.

**Lint:** changed files only (full lint OOMs). **Run tsc** — W1a shipped tsc-red (eslint-green); do not repeat.

## Tasks

1. **Cache/dedup theme vectors by normalized theme string.** A user's theme vocabulary is small and stable. Before `embed`: if a record with the same normalized (lowercased, trimmed) theme string already exists, **reuse its `themeVector` — 0 calls**. Embed only genuinely new strings. Over time → near-zero calls.

2. **Move off the synchronous `save()` into a governed background pass.** `touchThemes` must not block the timeline write and must not fan out network calls on the hot path. Route it through the `useEmbeddingIndexer` idle pass under `AIBackgroundBudget` (same governor as the rest of the background AI layer). In `save()`, at most mark the doc "dirty for theme-touch"; process in the idle batch. **Do NOT fire-and-forget from `save()`** — that is the digest-storm class of bug.

3. **Transaction around read-modify-write.** Wrap match→mutate→put in one `readwrite` tx of `aiThemeLedger` (or process a note's themes in a single tx) so concurrent passes don't lose `count`/evidence.

4. **Minor cleanups (from review):**
   - `reconcileStub()` — stop calling it in the loop (leave the branch as a commented stub).
   - Evidence cap: if keeping 3, use first + last + **top-1 by salience**, not middle-by-array-position.
   - Remove the no-op `Array.from(new Set([...]))` object dedup.

## Acceptance
- [ ] Test: `touchThemes` on an **already-known** theme string → **0** `AIService.embed` calls (mock embed, assert call count 0).
- [ ] Test: bulk run of N notes with repeated themes → embed-call count = number of **unique new** theme strings, not total.
- [ ] `save()` does not block on theme-touch network; timeline write is independent; theme-touch runs via the governed idle pass.
- [ ] Concurrent `touchThemes` on one theme do not lose `count` (tx test or sequential guarantee).
- [ ] W1a C2-scaffold stays green; `tsc` exits 0; lint clean on changed files.

## Out of scope
Read-path/injection (waits on A2-interface), reconcile branch (Stage 3), archived tier / forgetting (W3, Stage 2).

**After delivery — my review:** re-trace the call-chain (governed path + tx + no network fan-out in `save`). Only after this closes do we proceed to **W4-voice**.
