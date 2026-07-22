# "История моей жизни" — date recognition + multi-note per day (Antigravity tickets, July 2026)

Self-contained. Prefix: `LIFE-`. Two linked bugs in the life-story timeline. **Order: LIFE-1 → LIFE-2** (LIFE-2 depends on LIFE-1's correct event date). Owner reviews after.

## Root cause (verified against code)

**Bug A — wrong date.** A note written on 21 Jul about "сегодня отвёз Вику" shows up under **20 Jul**. Two compounding flaws:
1. `summarizeDocument` (`functions/src/ai/summarizeDocument.ts`) **never receives the writing date** — its input is only `{ content, mood, recentContext }` (`:59-63`). So the AI cannot resolve "сегодня/вчера/позавчера" into a real date.
2. `LifeStoryService.getDefaultEventDate(writingDate)` **blindly subtracts one day** (`LifeStoryService.ts` `d.setDate(d.getDate() - 1)`), and both `autoPopulateFromTimeline` and `LifeStoryTimeline.loadData` use it. So every event is shifted −1 from the writing date regardless of what the note actually says.

**Bug B — multiple notes per day collapse.** In `LifeStoryTimeline.loadData` the day map does `dayMap.set(eventDate, {...})` per timeline entry — so if 3-4 notes share a day, **only the last one's** summary/facts/insights survive; the rest are silently dropped.

## Design invariants (don't break these)

- **Do NOT change `aiTimeline.date`.** It equals the writing date (`AISummaryService.ts:93-102`) and is read by mood-trend, monthly digests and temporal RAG. Changing its meaning ripples across those. Add a **new** field for the event date instead.
- **0 new LLM calls.** The event-date inference piggybacks on the existing `summarizeDocument` call.
- IDB: adding optional fields to `AIDocumentSummary` / `AITimelineEntry` needs no version bump (idb stores are keyed by keyPath; extra fields are fine). Only bump if a new store/index is added.
- Existing already-summarized notes won't have the new field until re-indexed — fall back gracefully (see LIFE-1 task 4).

---

## LIFE-1 — AI infers the real event date from the note 🔴

**Goal:** the day a note is filed under reflects the events described, not a blanket writing-date−1.

**Tasks:**
1. **Pass the writing date into `summarizeDocument`.** Add `noteDate?: string` (ISO `YYYY-MM-DD`, from the note's `lastSessionAt`) to the input schema (`functions/src/ai/summarizeDocument.ts:59`), and thread it from the client: `AIService.summarize` (`src/features/ai/services/AIService.ts`, the `summarizeDocument` callable) → its caller in `useEmbeddingIndexer.ts` (pass the doc's `lastSessionAt` date).
2. **Add `eventDate` to the summary output.** Extend `SUMMARY_SYSTEM_PROMPT` (`:36-52`) with a field:
   > `- eventDate: дата событий заметки в формате YYYY-MM-DD. Запись написана {noteDate}. Определи по тексту: «сегодня» → дата написания; «вчера» → −1 день; «позавчера» → −2; конкретный день недели или дата → вычисли относительно даты написания. Если в тексте нет временных указаний — верни дату написания. НЕ вычитай день «по умолчанию».`
   Add `eventDate` to the JSON schema/parse (`:165-216` area), validate it's a plausible `YYYY-MM-DD` (and not in the future relative to noteDate); on any parse failure default to `noteDate`.
3. **Store it.** Add optional `eventDate?: string` to `AIDocumentSummary` and `AITimelineEntry` (`localDb.ts`), populate in `AISummaryService`/`AITimelineService` where the timeline entry is built (next to `date`).
4. **Use it, drop the −1 shift.** Replace `LifeStoryService.getDefaultEventDate` usages so the life-story event date = `timelineEntry.eventDate ?? timelineEntry.date` (the AI value, **fallback = writing date as-is, NOT writing−1**). Update `autoPopulateFromTimeline` and `LifeStoryTimeline.loadData` accordingly. Keep `getDefaultEventDate` only as the last-resort fallback if you want, but it must default to the **writing date**, not −1.
5. Keep the manual date-edit affordance working (a user can still correct a day).

**Cost:** 0 new LLM (piggyback). **Risk:** low-medium — touches the summarize schema (server) + the timeline build; the injection guard already covers `content`, and `noteDate` is a controlled ISO string (validate format server-side).

**Acceptance:** a note written on 21 Jul saying "сегодня…" files under **21 Jul**; a note written on 22 Jul about "вчерашнюю поездку" files under **21 Jul**; a note with no time words files under its writing date (not −1); already-summarized old notes still appear (fallback to writing date); manual date edit still works.

---

## LIFE-2 — Show ALL notes of a day, not just the last 🟡

**Depends on LIFE-1.** Once event dates are right, a day can legitimately hold several notes — surface them all.

**Where:** `LifeStoryTimeline.loadData` (`src/features/ai/components/LifeStoryTimeline.tsx`) — the `dayMap.set(eventDate, …)` overwrite; and `LifeStoryService.autoPopulateFromTimeline` (single `text`).

**Tasks:**
1. **Aggregate, don't overwrite.** In `loadData`, group timeline entries by `eventDate` into an **array** per day (not a single object). Collect all `documentId`s, and the **union** of `facts`, `insights`, `themes` across the day's notes (dedup identical strings).
2. **Render per day:** show each note's summary line (a short list when there are several — e.g. "• summary1 • summary2"), then the merged Facts and Insights blocks (already two separate lists per WEAVE/earlier work) built from the union. Keep the collapse/expand chevron.
3. **`autoPopulateFromTimeline`:** when several notes map to one `eventDate`, aggregate their summaries into the day's `text` (join distinct summaries) rather than overwriting with the latest; keep aggregating `sourceDocumentIds` (already does). Never overwrite an `edited` entry (already guarded).
4. **User-edited days:** if a `lifeStory` entry for that date has `edited: true`, show the user's text (their override) but still show the aggregated Facts/Insights below if useful — confirm this reads well; if messy, edited text wins entirely.

**Cost:** 0 LLM (pure IDB read + local aggregation). **Risk:** low — display/aggregation only.

**Acceptance:** a day with 3-4 notes shows all their summaries and the merged facts/insights (nothing dropped); a day with one note looks as before; edited days keep the user's text; facts/insights don't duplicate across notes.

---

### Note
This supersedes the earlier "event = writing date − 1" heuristic (my own earlier call) — it was wrong for notes about "today". The AI-inferred `eventDate` is the correct approach and costs no extra LLM.
