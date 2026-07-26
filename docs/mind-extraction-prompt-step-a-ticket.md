# AG-EXTRACT-A — extraction prompt v2: verbatim quote, hedges, idiolect

**Priority:** P1 · feeds W1 evidence, the W3 judge and W4 voice · Scope: Medium
**Files:** `functions/src/ai/summarizeDocument.ts`, `src/features/ai/services/AIService.ts`, `src/core/storage/localDb.ts`, `AISummaryService.ts`, `useEmbeddingIndexer.ts`, `AIThemeLedgerService.ts`, `AILexiconService.ts`.

The full prompt text, guard implementation and client plumbing were specified by the planners and should be followed as written. This ticket captures the scope, the constraints and what "done" means.

## What changes and why

Three targeted fixes to `SUMMARY_SYSTEM_PROMPT`, each closing a place where the current prompt asks for the wrong thing:

1. **`quotableSentence`** — the model picks the quotable line. Today `AIThemeLedgerService.extractVerbatimSentence` picks it client-side by counting shared words, falling back to "the first sentence". The signature feature («твоими словами: „…"») rests on that heuristic.
2. **Hedges preserved in `extractedFacts`** — the prompt currently asks for "конкретные факты", so the model flattens conditions on the way in. The W3 judge then rejects beliefs for losing a qualifier that was never captured. Fixing the input is cheaper than judging the output.
3. **`authorPhrases`** (new field, abstain-by-default) — `frequentWords` asks for "significant nouns and verbs", which yields topic words, not the user's own vocabulary. W4 voice needs «залипание», not «прокрастинация».

**Do not repurpose `frequentWords`.** It has three live consumers (word cloud, markdown export, and `AILexiconService`). Add `authorPhrases` alongside; the lexicon prefers it and keeps `frequentWords` as the fallback for notes summarised before v2, so old notes stay consistent and nothing regresses.

## Constraints

- **Verbatim guard, server-side** (`M2`): the returned quote must be a substring of the text the model actually saw (`sanitizedContent`); otherwise drop it. "Verbatim" without a substring check is just a promise. Same pattern as the W8a date guard. The documented tolerance for ё/е and typographic quotes is a deliberate compromise — keep the comment explaining it.
- **Client re-check in the ledger**: use the model's quote only if it is an exact `includes` of the note content; otherwise fall back to the existing algorithm. Never worse than today.
- **`promptVersion` stamp on every summary row** (`M5`): without it the ledger fills with a mix of schemas and no before/after comparison is possible. Absent = v1.
- **Anchor strings**: the scaling code does `.replace('insights: ключевые мысли', …)` and `.replace('extractedFacts: конкретные факты', …)`. Both substrings must survive verbatim in the new prompt.
- Additive optional fields on `aiSummaries` — no IDB version bump needed.

## One correction to the sequencing

**The before/after eval ships in this ticket, not after it.** The planners put the extraction eval (`M7`) in Step A's checklist but framed the run as a pre-merge manual comparison. Make it a committed fixture: notes → expected fields (the quote is the planted sentence, the hedge survives, `authorPhrases` empty on a plain note, sensitive absent), plus a guard that the existing 12 fields did not regress.

A manual eyeball once, before merge, is not repeatable — and the next prompt change has nothing to compare against. Precedent: `citation_faithfulness.mjs`. LLM-dependent parts behind `OPENROUTER_API_KEY`, nightly, not per-PR.

## Acceptance

- [ ] `quotableSentence` is a real substring of the note; a paraphrase is dropped, not stored.
- [ ] A note with a hedged statement («иногда, но…») keeps the qualifier in `extractedFacts`.
- [ ] `authorPhrases` returns `[]` on a note with no distinctive vocabulary — an empty result is correct, not a failure.
- [ ] `frequentWords` behaviour is unchanged; its three consumers still work.
- [ ] The ledger uses the model's quote when it passes the client re-check, and the old algorithm otherwise.
- [ ] `AILexiconService` prefers `authorPhrases`, falls back to `frequentWords` for pre-v2 rows.
- [ ] Every new summary row carries `promptVersion`.
- [ ] Both anchor substrings are present in the new prompt (assert in a test — a scaling silently no-oping is invisible otherwise).
- [ ] Eval fixture committed and passing.
- [ ] `tsc` 0 (root + functions), **full** vitest suite, **full** `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192`.
- [ ] Cloud Functions deployed (`firebase deploy --only functions`) — the prompt lives server-side and the push alone changes nothing.

## Out of scope

Step B (`memoryUnits[]` schema migration, few-shot), Step C (sensitivity with C1, revision flag with reconcile, aliasHint, ledger-aware theme labels), and re-extraction of old notes by `promptVersion` — that gets its own ticket once there is a consumer.
