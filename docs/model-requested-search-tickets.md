# AG-SEARCH-1..3 — let the model ask for a search, and route aggregate questions

Follow-up to the v0.7.65 search plan. FIX-1, FIX-2 and FIX-4 from that plan already landed (2026-07-31, uncommitted at time of writing): the attached note no longer switches the archive off, the search block states its coverage, and the intent patterns had their broken `\b` boundaries replaced. What remains is the structural half.

**Read AG-SEARCH-3 first — it is a trap the other two will fall into.**

---

## AG-SEARCH-1 — the model requests a search itself

**Priority:** P2 · Scope: Medium (1–2 days)
**Files:** `src/shared/ai/prompts.ts` + `functions/src/shared/prompts.ts` (identical, whole-file parity enforced by `src/core/__tests__/promptsParity.test.ts`), `src/features/ai/hooks/useAIChat.ts`, `src/features/ai/hooks/useAIChatContext.ts`, `src/features/ai/pages/AIPage.tsx`.

**Blocked by:** AG-CHAT-1. Do not start until it has landed — see "Marker collision" below.

### Why

Search intent is decided by a client-side regex before the model ever sees the message (`looksLikeNoteSearch`). The regex is decent and now actually fires, but the best intent classifier in the system — the model — has no way to say "I need the archive for this". `NOTES_GUARD` even tells it to *offer* to search, which is a dead end: the user says "yes, search", and that reply has to pass the same regex.

### Design

A marker, in the style of the existing `[#id]` citations — no function calling, provider-agnostic.

**Prompt** (addition to `NOTES_GUARD`, both files, byte-identical):

> Если тебе нужны заметки, которых нет в контексте, или пользователь просит поиск, а подходящего блока результатов нет — заверши ответ отдельной строкой-маркером: `[[ПОИСК: краткий запрос]]`. Не более одного маркера, не объясняй его.

**Client:**

- Extract the marker from the **final** answer only, never from streaming partials — `sanitizeCitations` already runs on partial text at `useAIChat.ts:359`, and a marker rendered mid-stream would flash on screen.
- First marker wins, the rest are dropped. Matching must be case-insensitive and tolerant of spacing; a marker that escapes the regex is shown to the user as raw text, which is precisely the defect AG-CHAT-1 exists to fix.
- The extracted query becomes a chip: **«🔍 Поискать в заметках: „{query}“»**. The answer renders without the marker.

**The forced turn.** Do not synthesise a fake user message ("поищи в заметках: …") — it pollutes the transcript and re-enters through the same regex the feature exists to bypass. Use a ref set on tap:

```ts
const forcedSearchRef = useRef<string | null>(null);
// at the top of buildContext:
const forced = forcedSearchRef.current;
forcedSearchRef.current = null;
const explicitSearch = forced ? true : shouldRunFullSearch(text, !!attached);
const effectiveQuery = forced ?? text;   // use in the search branches instead of `text`
```

`shouldRunFullSearch` (in `aiChatTransport.ts`) is already a pure function with a truth-table test — compose with it, do not re-implement its logic inline.

### Marker collision — why this is blocked

AG-CHAT-1 changes the citation sanitiser to **remove** anything bracket-shaped it does not recognise, instead of degrading it to visible text. `[[ПОИСК: …]]` is a second bracket convention in the same pipeline. Land in this order:

1. AG-CHAT-1 — the citation rule, with a single shared module owning "what is a marker".
2. AG-SEARCH-1 — register `[[ПОИСК:]]` in that same module.

Implemented the other way round, either the sanitiser eats the marker or the marker survives as visible text — both regressions, both silent.

### Policy

- The chip is a **manual** action: one tap, one search turn, counted against the daily AI limit.
- An automatic mode (search without a tap) is a setting, **off by default**. Reads are the binding quota on this project — a search is an embed plus a rerank, and each AI call also costs ~5 Firestore reads server-side (see `docs/read-quota-tickets.md`, AG-READ-4). An automatic loop of them is exactly the shape that has exhausted quotas here twice.
- Loop guard: at most one automatic search per chain, counter in a ref, reset on an answer with no marker.
- Repeat of the same query that already returned nothing → "уже искал, ничего не нашлось", no second turn.
- The model may both answer and ask: show the text and the chip.

### Acceptance criteria

- A marker never reaches the screen, streaming or final.
- Tapping the chip runs a real archive search for the model's query and produces a normal answer with citations.
- The transcript contains no synthetic user messages.
- With the automatic mode off (default), no search runs without a tap.

### Tests

- `extractSearchRequest`: marker at the end → clean text + query; no marker → `null`; two markers → the first; odd casing and spacing → still matched.
- The marker is not extracted from a streaming partial.
- Forced search: the ref path runs the search for the model's query, not the user's last message, and the ref is cleared after one use (a second turn must not silently re-search).
- Loop guard: two consecutive marker answers produce at most one automatic search.

---

## AG-SEARCH-2 — aggregate questions must not go through top-K retrieval

**Priority:** P2 · Scope: Small–Medium
**Files:** `src/features/ai/utils/aiChatTransport.ts` (detector), `src/features/ai/hooks/useAIChatContext.ts` (routing), `src/features/ai/services/AIThemeLedgerService.ts`, `src/features/ai/services/AITimelineService.ts`.

### Why

"Сколько раз я писал про X", "как часто", "что чаще всего" cannot be answered by a top-K search **by construction** — it returns the 8 most relevant notes, and the model then guesses a frequency from them. The honest answer needs counts, and the counts already exist: `AIThemeLedgerService` holds `count`, `firstSeenAt` and `lastReinforcedAt` per theme (W1, in production), and `AITimelineService` plus the monthly digests hold the period aggregates.

### Fix

Detect the aggregate shape and route to the exact source instead of (or alongside) retrieval. Label the block explicitly as **exact statistics over the whole base, not top-K**, so the model does not hedge a number it was handed.

Patterns to start from — **but see AG-SEARCH-3, the version in the original plan is written with `\b` and would never fire**:

- `сколько раз`, `как часто`
- `(все|каждую|всю базу|целиком|полностью)` near `(замет|запис)`
- `статистик|динамик|тенденц|закономерн|паттерн|чаще всего`

When the ledger has no entry for the theme, say so plainly — that is a "no data" answer, not a licence to estimate from the top-K notes. A failed or empty ledger read must not become "you never wrote about this" (`docs/fail-read-sweep-ticket.md`).

### Acceptance criteria

- "Сколько раз я писал про X" answers from ledger counts, and names the count.
- The model is told the block is exact, not a sample.
- A theme absent from the ledger produces an explicit "no data" answer.

### Tests

- Detector: the aggregate phrasings above → true; "поищи про X" → false (it must still take the retrieval path).
- Routing: an aggregate query builds a ledger block and does not depend on retrieval results.
- Empty ledger → the "no data" wording, not a fabricated count.

---

## AG-SEARCH-3 — `\b` does not exist next to Cyrillic; stop writing it

**Priority:** P1 · Scope: Small · **Do this first**
**Files:** `src/features/ai/utils/aiChatTransport.ts` (done), then a sweep + a guard test.

### Why

JavaScript defines `\b` as a transition between `[A-Za-z0-9_]` and anything else. A Cyrillic letter is never a word character, so a boundary never occurs beside one:

```js
/\b(найди|поищи)\b/i.test('найди про Сашу')  // false
/\b(найди|поищи)\b/i.test('a найди b')       // false — not even with Latin neighbours
```

Every Russian pattern written with `\b` in this codebase has been dead since it was written. In `NOTE_SEARCH_PATTERNS` that was the entire search-verb alternation, `\bзапис`, `\b(пиш|писа)\b` and `(про|о)\b` — so "просканируй всё" ran no search at all, while "поищи в заметках" worked only by accident, through a different pattern matching the noun. Fixed there on 2026-07-31 using `LB`/`RB`, the Cyrillic-safe boundaries the temporal patterns already used.

This is not a one-file problem. The aggregate patterns proposed in the v0.7.65 plan are written the same way and would have shipped equally dead.

### Fix

- Sweep every Russian-language regex in `src/` and `functions/src/` for `\b`. For each: replace with `LB` / `RB`, or state why the pattern is Latin-only and leave it.
- Live patterns change behaviour when they start firing. For each revived pattern, check it does not now fire on ordinary chat — a bare search verb needed a target term added (`SEARCH_TARGET`) to stop "покажи мне картинку" triggering a full archive search.
- Add a guard test that fails on `\b` adjacent to a Cyrillic character in the intent-pattern modules, with a message pointing at `LB`/`RB`. A lint rule would be better if one can express it; a test is enough.

### Acceptance criteria

- No Russian-language regex in the codebase relies on `\b`.
- The guard test fails when `\b[а-яё]` or `[а-яё]\b` is introduced.
- Every revived pattern has a positive test and a negative test — the negative one matters more here, because reviving a dead pattern can only ever add matches.

---

## Process (all three)

Same as AG-BG-1:

- Full `npx vitest run` at the repo root **and** in `functions/`.
- `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192`; the full run OOMs on this repo, so lint changed files individually if needed and say so. Do not pipe lint through `tail` — it masks the exit code.
- `npx tsc --noEmit`.
- `promptsParity.test.ts` after any prompt edit — it compares the two files whole, so copy the file, do not hand-edit both.
- **Verify every new test is non-vacuous**: revert its fix, confirm that exact test fails, restore.
- Attach the `tsc`, lint and both suite outputs to the report.
