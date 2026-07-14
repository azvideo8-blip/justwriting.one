# Seamless Notes + AI — Tickets (July 2026)

Self-contained. Prefix: `SEAM-`. Goal: make the app's AI understand the context of a **daily** note-writer as seamlessly as possible — without letting note-processing eat the token/write budget.

**North-star cost rule (read first):** there is exactly **ONE** expensive unit — the per-note `summarizeDocument` LLM call. Everything else is either (a) piggybacked as extra fields on that single call, or (b) derived **locally** (no LLM) from data we already have. New background LLM work goes through the shared scheduler in **SEAM-0** and respects one shared daily budget. If a ticket adds an LLM call outside SEAM-0's governor, it's wrong.

**Current baseline (already shipped — do NOT rebuild):**
- Auto embeddings on idle (`useEmbeddingIndexer` → `embeddingIndexer.ts`), chunked 4096-dim, hybrid retrieval (BM25+vector RRF + rerank + parent-doc), query cache, facet clustering + portrait + facet-judge, chat long-term memory (fact/insight/commitment/preference), timeline/monthly-digest/mood-trend, people index, per-turn context assembly (`useAIChatContext`), contact-doors.
- **The gap:** `AIService.summarize` runs **only** when a user manually opens a note in the archive (`ArchiveNoteList.handleAIClick`, `DocumentPreview`). So timeline / digests / mood-trend / people / rerank-cards only populate for browsed notes. A daily writer who just writes never builds this layer.

**Existing budget primitives to reuse (do not add parallel ones):**
- `src/features/ai/hooks/useEmbeddingIndexer.ts` — idle scheduler, `DAILY_LIMIT = 20`, `BATCH_SIZE = 3`, debounce 30s, `requestIdleCallback`, backoff on RATE/DAILY.
- `src/features/ai/utils/firestoreWriteBudget.ts` — `tryReserveWriteBudget()` (300/day) and `tryReserveSummarizeBudget()` (100/day) client-side Firestore write caps.
- `src/features/ai/store/useAiLimitStore.ts` — per-user daily chat cap.
- Embeddings/rerank are limit-exempt infra calls (global guard only) — see `[[ai-infra-calls-bypass-limits]]`.

**Implementation order (dependency):** SEAM-0 → SEAM-1 → SEAM-2 → SEAM-7 → SEAM-4 → SEAM-3 → SEAM-6 → SEAM-5 → SEAM-8 → SEAM-10 → SEAM-9.

**Priority key:** 🔴 foundational / high-leverage · 🟡 solid value · 🟢 nice-to-have polish.

---

## SEAM-0 — Unified background-AI scheduler + shared daily budget 🔴

**Context:** `src/features/ai/hooks/useEmbeddingIndexer.ts`, new `src/features/ai/services/AIBackgroundBudget.ts`.

**Why:** ten features could each spawn their own background LLM calls and burst the provider/Firestore quota. We need ONE governor. We already have an idle loop and per-path caps — unify them behind a single budget so the total daily LLM spend is bounded and predictable.

**Design — a token-*proxy* budget, not real token counting** (keep it simple):
- Assign each background call type a fixed **cost weight** (calls, not tokens — a token counter is over-engineering here):
  - `summary` = 1 (the note summarize call)
  - `narrative` = 1 (monthly digest / thread naming)
  - `portrait_section` = 1
  - embeddings/rerank = 0 (infra, exempt — already the case)
- One daily budget: `AI_BG_DAILY_BUDGET = 25` (weights summed). localStorage key `ai_bg_budget`, `{ date, spent }`, resets on UTC date change — mirror `getIndexerDailyUsage` exactly.
- Three priority tiers drained in order each idle tick: **P0** note-summary → **P1** narrative/digest → **P2** portrait/threads. P0 never starved by P2.
- API:
  ```ts
  // AIBackgroundBudget.ts
  export function canSpend(weight: number): boolean;   // spent + weight <= budget
  export function spend(weight: number): void;          // best-effort localStorage bump
  export function budgetStatus(): { spent: number; budget: number };
  ```

**Tasks:**
1. Create `AIBackgroundBudget.ts` with the above (copy the date-rollover pattern from `useEmbeddingIndexer.getIndexerDailyUsage`).
2. In `useEmbeddingIndexer.runBatch`, gate the existing embed loop's *summary* step (SEAM-1) and any SEAM narrative/portrait work with `canSpend()/spend()`. Keep the existing `DAILY_LIMIT = 20` embed cap as-is (embeds are exempt/weight-0; that cap stays a separate rate guard).
3. Expose `budgetStatus()` in the Diagnostics page (`src/features/ai/pages/DiagnosticsPage.tsx`) so we can watch spend.

**Budget note:** this ticket *is* the budget. Net LLM delta: 0.

**Acceptance:** with `AI_BG_DAILY_BUDGET` set to 0, no background summarize/narrative/portrait calls fire (verify via network/log); embeds still run. Budget resets at UTC midnight.

---

## SEAM-1 — Auto-summarize in the idle pipeline + enrich the summary schema + remove manual "AI" buttons 🔴

**Context:** `src/features/ai/hooks/useEmbeddingIndexer.ts`, `src/features/ai/utils/embeddingIndexer.ts`, `src/features/ai/services/AISummaryService.ts`, `functions/src/ai/summarizeDocument.ts`, `src/features/ai/services/AIService.ts` (`AISummaryPayload`), archive UI.

**Why:** closes the core gap. Summaries must build automatically for every note, in the same idle loop that already builds embeddings — bounded by SEAM-0. And since summaries become automatic, the per-note manual "✨ AI" button is now redundant and must be removed (user request).

**Part A — enrich the ONE summarize call** (so SEAM-4 & SEAM-7 cost nothing extra):
- In `functions/src/ai/summarizeDocument.ts`, extend the JSON schema the model returns with:
  - `commitments: string[]` — first-person future intentions the writer stated ("I'll call mom", "start running Monday"). Empty if none.
  - `valence: number` (−1..1) and `arousal: number` (0..1) — affect estimate for the note.
- Mirror the new fields into `AISummaryPayload` (`AIService.ts`) and `AIDocumentSummary` (`localDb.ts`, IDB bump 12 → 13; new optional fields, no index needed).
- Update `functions/src/ai/__tests__/summarizeDocument.test.ts` for the new fields.

**Part B — auto-run in the idle loop:**
1. Add a "stale summary" detector paralleling `findStaleDocuments`: a note is summary-stale if it has no `aiSummaries` entry OR its `contentHash` differs (store `contentHash` on `AIDocumentSummary`). Add `findStaleSummaries()` in `embeddingIndexer.ts`.
2. In `useEmbeddingIndexer.runBatch`, after the embed batch, if `AIBackgroundBudget.canSpend(1)` and `localStorage 'auto_summarize_enabled' !== 'false'`, summarize up to `min(BATCH_SIZE, remaining)` stale-summary notes, `spend(1)` each, and `AISummaryService.save()` (which already fans out to timeline/digest/people). Respect the same RATE/DAILY backoff already in `runBatch`.
3. Gentle spacing between calls (reuse the 150ms spacing pattern).

**Part C — remove the manual AI button (redundant after auto-summary):**
- `src/features/archive/components/NoteRow.tsx`: remove the `Sparkles`/`Loader2` AI button (lines ~262–272) and the `aiProcessed`/`aiLoading`/`onAIClick` props.
- `src/features/archive/components/GridNoteCard.tsx`: same (button ~121–131, props).
- `src/features/archive/components/ArchiveNoteList.tsx`: remove `handleAIClick`, `aiProcessedMap`, `aiLoadingMap`, and the three `onAIClick`/`aiProcessed` prop passes (~198, 227, 275).
- `src/features/archive/components/DocumentPreview.tsx`: remove the manual "summarize" `Button` (~415) and its handler. Keep the summary *display* block (facts/people) — it now renders whatever the background job produced, or a subtle "анализируется…" placeholder when absent.
- Keep the **Settings → App "Auto-summarize notes" toggle** (`auto_summarize_enabled`) — it now governs the automatic pipeline (already the flag `runBatch` checks). Update its hint text (`settings_auto_summarize_hint`) to reflect that it's automatic.
- Remove now-dead i18n keys / `aiProcessed` plumbing only where they become unused (don't touch admin table's own column).

**Budget note:** +1 weight per new/changed note per day, capped by SEAM-0 (≈ up to 20 notes/day). No per-turn cost. Net: bounded, and it *replaces* the old ad-hoc manual calls.

**Acceptance:** writing a note and leaving the app idle produces an `aiSummaries` + `aiTimeline` entry within a couple idle ticks (respecting budget). No ✨ button anywhere in archive. Toggle off → no auto summaries.

---

## SEAM-2 — Backfill summaries for the existing corpus, spread over days 🔴

**Context:** `src/features/ai/utils/embeddingIndexer.ts`, `src/features/ai/pages/DiagnosticsPage.tsx`.

**Why:** a long-time writer's back-catalogue has embeddings but no summaries. Backfill must never burst — it drains over many days within SEAM-0's daily budget.

**Tasks:**
1. `findStaleSummaries()` (SEAM-1) already returns the backlog. The idle loop naturally drains it a few/day. Add a small **coverage stat** to Diagnostics: `summarized / total`, and `est. days to full` = `ceil(remaining / dailyBudgetForSummaries)`.
2. Add an optional manual "Summarize N now" button in Diagnostics (admin/power-user), hard-capped per click (e.g. 10) and still going through `AIBackgroundBudget` — no unbounded "summarize all".

**Budget note:** zero new mechanism; reuses SEAM-0 + SEAM-1. The point is *bounded* backfill, explicitly no burst (see `[[firestore-write-quota-incident-2026-07-05]]`).

**Acceptance:** with 500 un-summarized notes, no single day exceeds the budget; coverage climbs daily; the manual button never fires more than its per-click cap.

---

## SEAM-3 — Local trend / change-detection (emerging vs fading themes, mood delta) 🟡

**Context:** new `src/features/ai/utils/contextTrends.ts`, `src/features/ai/services/AITimelineService.ts` (has `getMoodTrend`), `useAIChatContext.ts`.

**Why:** the portrait is a static snapshot. A daily writer wants the AI to notice *movement* ("last month you've written about work stress more"). This is pure local computation over `aiTimeline` — **no LLM**.

**Tasks:**
1. `computeThemeDeltas()`: bucket `aiTimeline.themes` by month for the last ~3 months; compute per-theme frequency delta (this month vs prior baseline). Return top-3 rising and top-3 fading themes.
2. Mood delta: reuse `AITimelineService.getMoodTrend` + SEAM-7 valence to compute a simple slope (improving / flat / declining).
3. In `useAIChatContext.buildContext`, when `isFirstTurn` (already a branch that injects proactive context), append a compact block: `[Изменения за последнее время] Чаще: …; Реже: …; Настроение: …`. Cap ~300 chars. Only include when signal is non-trivial (delta above a threshold).

**Budget note:** 0 LLM. Runs on first turn only, reads IDB.

**Acceptance:** unit test `contextTrends.test.ts` with synthetic timeline → correct rising/fading sets and mood slope. Block appears in first-turn context only when deltas are meaningful.

---

## SEAM-4 — Commitment tracking + proactive follow-up 🟡

**Context:** `AISummaryService.ts`, new `src/features/ai/services/AICommitmentService.ts`, `useAIChatContext.ts`. Depends on SEAM-1 Part A (`commitments` field).

**Why:** the writer states intentions daily ("I'll start X"). Nothing resurfaces them. Surfacing open commitments makes the AI feel like it remembers. Extraction is **free** (piggybacked on SEAM-1's summarize); only surfacing logic is new, and it's local.

**Tasks:**
1. New IDB store `aiCommitments` (bump with SEAM-1's version): `{ id, text, documentId, createdAt, date, status: 'open'|'done'|'stale', vector? }`. In `AISummaryService.save`, upsert each `summary.commitments[]` as an `open` commitment (dedupe by cosine>0.9 against existing open ones, reusing chat-memory dedup pattern in `AIChatMemoryService`).
2. Auto-age: commitments older than N days (e.g. 21) with no matching later note → `stale`. A commitment whose text semantically matches a later note's `extractedFacts`/`summary` (cosine>0.85) → `done`. Compute lazily on read.
3. In `useAIChatContext` (psyche personas / coach, first turn), inject up to 3 open commitments: `[Открытые намерения из заметок] — «…» (5 дней назад)`. Let the persona decide whether to gently follow up.

**Budget note:** 0 extra LLM (extraction rides SEAM-1; matching uses existing embeddings). 

**Acceptance:** a note "буду бегать по утрам" creates an open commitment; a later note "сегодня пробежка" flips it to done; unresolved ones surface in coach context.

---

## SEAM-5 — Narrative threads (ongoing storylines) over topic facets 🟡

**Context:** new `src/features/ai/services/AIThreadService.ts`, reuse `facetClustering` utils, `AIProfileFacetBuilder` patterns.

**Why:** facets are *topic* clusters, not *temporal narratives*. A writer has arcs — a move, a job search, a relationship. A thread = a time-ordered cluster with an evolving one-paragraph summary, so the AI can say "the thread about your move" coherently.

**Tasks:**
1. Cluster note embeddings **with a recency/temporal bias** (chain notes that are both semantically close AND near in time) into threads. This is local (embeddings only) — model on `AIProfileFacetBuilder`'s clustering, add a time-decay term to the similarity.
2. For each thread with ≥3 notes, generate **one** short narrative summary via `summarizeFacet`-style call — but through `AIBackgroundBudget` P2 (`narrative` weight), and only when the thread's note set changed materially since last summary (hash the member id set). Cache in IDB store `aiThreads`.
3. Expose `AIThreadService.getRelevant(queryVector, k)` and wire into `useAIChatContext` note-search path (alongside facets) so "как там с переездом" pulls the thread summary + its recent notes.

**Budget note:** P2, ≤ a few narrative calls/day total, only on material change. Clustering itself is 0 LLM.

**Acceptance:** notes about one arc across weeks form a single thread with a coherent summary; asking about it retrieves the thread, not scattered notes.

---

## SEAM-6 — Always-on "lite" retrieval (silent grounding every turn) 🟡

**Context:** `useAIChatContext.ts` (`looksLikeNoteSearch` gate), `noteRetriever.ts`.

**Why:** note search is gated by regex intent detection, so many contextual questions never pull relevant notes. We want every turn silently grounded — **without** adding per-turn LLM cost.

**Tasks:**
1. Add a `lite` retrieval path: embed the user turn (embeds are exempt/cheap) → local vector top-k (`topKMultiWithChunkIndex`) → take top 2–3 snippets. **Skip the cloud rerank and query-expansion** on this path (those are the expensive bits). Reuse the already-loaded `allEmbeddings`.
2. In `buildContext`, when the existing heuristics *don't* trigger a full search, run lite retrieval and inject a small `[Возможно релевантные заметки]` block (cap ~1200 chars, 2 snippets). Full search path unchanged when triggered.
3. Guard against noise: only inject if top cosine ≥ a floor (e.g. 0.5), else nothing.

**Budget note:** +1 embed per turn (exempt infra), 0 chat-LLM, no rerank. Per-turn token growth bounded by the char cap.

**Acceptance:** a vague turn ("что мне с этим делать") that previously pulled nothing now silently includes the most relevant note when one is clearly on-topic, and injects nothing when nothing clears the floor.

---

## SEAM-7 — Richer affect model (valence/arousal → finer mood trend) 🟢

**Context:** SEAM-1 Part A (`valence`/`arousal` on the summary), `AITimelineService.ts`, `MoodTrend.tsx`, `contextTrends.ts` (SEAM-3).

**Why:** `tone` is a single coarse string. Valence/arousal (already captured free by SEAM-1) enables a real mood slope and "what precedes low moods" detection.

**Tasks:**
1. Persist `valence`/`arousal` into `aiTimeline` in `AISummaryService.save`.
2. `AITimelineService.getMoodTrend` (or a new `getAffectTrend`): monthly mean valence + slope. Feed SEAM-3's mood delta.
3. Optional local "trigger" heuristic: themes over-represented in the lowest-valence quartile of notes → `[Заметка] темы, чаще связанные со спадами: …` (local, no LLM). Keep behind SEAM-3's threshold gating.

**Budget note:** 0 extra LLM (rides SEAM-1). 

**Acceptance:** mood trend reflects valence, not just tone; low-valence theme association computed correctly on synthetic data.

---

## SEAM-8 — Contradiction / self-insight surfacing 🟢

**Context:** new `src/features/ai/utils/contradictionDetect.ts`, `useAIChatContext.ts`, portrait/facets.

**Why:** high therapeutic value — noticing when a new note diverges from an established pattern. Detection is **local** (embedding + heuristic); phrasing is left to the persona (no dedicated LLM call).

**Tasks:**
1. Heuristic: for the current/most-recent note, compare its affect/theme signature against the portrait's or facet's established baseline; flag strong divergence (e.g. a theme the writer usually frames positively now strongly negative valence, or vice-versa).
2. When a divergence clears a confidence threshold, inject a *neutral observation seed* into coach/psyche context: `[Возможное расхождение с прошлым паттерном] Раньше о «X» — скорее тепло; в последних заметках — тревожнее.` The model decides whether/how to raise it.
3. Strictly gated + rate-limited (≤1 per session) to avoid nagging.

**Budget note:** 0 LLM (detection local; persona already generating the turn phrases it).

**Acceptance:** synthetic "used to love job → now dreads it" notes produce a divergence seed; stable topics produce none.

---

## SEAM-10 — Incremental, sectioned portrait (cost reduction) 🟡

**Context:** `AIProfileService.generate`, `useEmbeddingIndexer` (auto-regen trigger), portrait storage.

**Why:** today the whole portrait is regenerated by a full LLM call on every dirty-facet resummarize — expensive and frequent. Sectioning + change-gating **reduces** spend.

**Tasks:**
1. Split the portrait into sections (e.g. `themes`, `emotional_patterns`, `strengths`, `growth`, `communication_prefs`). Store per-section text + the input hash (facet-set + style + prefs) that produced it.
2. On regen, only re-call the LLM for sections whose input hash changed; reassemble from cached sections otherwise. Each section regen = `portrait_section` weight through SEAM-0 P2.
3. Timestamp the portrait; expose freshness in Diagnostics.

**Budget note:** net **reduction** vs today (partial regen instead of full). Governed by SEAM-0 P2.

**Acceptance:** editing one facet regenerates only the affected section(s); portrait timestamp updates; total portrait LLM calls/day drop measurably vs baseline.

---

## SEAM-9 — In-writing context observation (bringing AI into the writing flow) 🟢

**Context:** `src/features/writing/components/WritingFinishModal.tsx`, `useAIChatContext`'s recent-context assembly, SEAM-1 summary output.

**Why:** the most direct "seamless" win — a single, quiet one-liner on finishing a note that connects it to recent themes ("перекликается с тем, что ты писал во вторник"). Must be cheap and optional.

**Design (cost-first):** **reuse SEAM-1's summary call — do not add a call.** The note is summarized anyway; extend that summarize schema (SEAM-1 Part A) with an optional `echo: string` — one sentence linking this note to the writer's recent themes, generated from the same context. Then the finish modal just *displays* `echo` when present. Zero extra LLM.
- Fallback if `echo` is deferred (note not yet summarized at finish time): show nothing, or a purely-local link ("похоже на заметку от вторника") computed from embeddings — no LLM.

**Tasks:**
1. Add optional `echo` to the summarize schema (SEAM-1 Part A) + `AIDocumentSummary`.
2. In `WritingFinishModal`, render `echo` as a subtle single line when the summary exists. Behind the `auto_summarize_enabled` toggle. Opt-out setting if desired.

**Budget note:** 0 extra LLM (rides SEAM-1). Local fallback is 0 LLM.

**Acceptance:** finishing a note that's been summarized shows one relevant echo line; disabling auto-summary hides it; no additional network call fires on finish.

---

## Cost summary (why this won't eat the budget)

| Feature | Incremental LLM cost |
|---|---|
| SEAM-1 auto-summary | 1 call / new note / day, capped by SEAM-0 (the ONE unit) |
| SEAM-2 backfill | same unit, spread over days, no burst |
| SEAM-4 commitments | **0** (rides SEAM-1) |
| SEAM-7 affect | **0** (rides SEAM-1) |
| SEAM-9 in-writing echo | **0** (rides SEAM-1) |
| SEAM-3 trends | **0** (local) |
| SEAM-8 contradictions | **0** (local) |
| SEAM-6 lite retrieval | **0** chat-LLM (embed-only, exempt) |
| SEAM-5 threads | ≤ few narrative calls/day, only on material change (P2) |
| SEAM-10 sectioned portrait | **net reduction** vs today |

Everything expensive collapses onto one per-note call, bounded by SEAM-0's daily budget. Derived intelligence is local.
