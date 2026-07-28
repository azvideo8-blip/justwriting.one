# AG-CLOUD-1 — make the Firestore rules a checked contract, and bound every write loop

**Priority:** P0 · this class caused four production incidents on 2026-07-28 alone · Scope: Medium
**Files:** `firestore.rules`, `functions/src/__tests__/rules.test.ts` (+ a new contract test), `src/core/storage/localDb.ts`, `src/features/ai/services/AISummaryService.ts`, `src/features/ai/services/AIEmbeddingService.ts`, `src/features/writing/services/WritingDraftService.ts`, `src/core/crypto/encryptMigration.ts`, `src/core/services/CloudSyncService.ts`, `src/features/ai/utils/firestoreWriteBudget.ts`.

## Why

Three places must agree on the shape of every cloud record: the client that builds the payload, `firestore.rules` that validates it, and the tests. **Nothing enforces that agreement**, and the rules use `hasOnly()`, which rejects the *entire write* on one unlisted field. The failure is silent — Firestore answers `permission-denied`, which reads as an auth problem, and the client retries forever.

Landed on 2026-07-28, all the same defect:

- `5461f761` — drafts: `maybeEncrypt` JSON-stringifies `pinnedThoughts` into one ciphertext string; the rule required `is list`. Every cloud draft save had been failing.
- `9953f4b3` — summaries: the rule allowed 9 fields while `saveSummaryToCloud` spreads the whole `AIDocumentSummary` (19). Every summary had stopped syncing when prompt v2 added fields.
- `9953f4b3` — embeddings: the rule capped `vectorsJson` at 500k while the client refuses only above `MAX_CLOUD_EMBEDDING_BYTES` (1M). At 4096 dims a multi-chunk note lands in the gap.

The rules tests were green throughout, because each one builds a fixture **by hand** and so only covers shapes someone remembered to write. `functions/src/__tests__/rules.test.ts` never sent `pinnedThoughts` at all.

Two of those rejections then fed a second failure: bulk loops treat a rejection as a per-record problem, keep going, mark nothing as done, and the next pass repeats the list. That exhausted the Firestore daily write quota twice in one day (`f63099f1`, `10bf9886`). The database is free-tier and, per Firestore's own error text, **cannot exceed that quota even with billing enabled** — so an unbounded write loop is a guaranteed day-long outage, not a cost problem.

## Part 1 — a checked type → constant → rule chain

Close the loop so a new field cannot reach production without the rule knowing about it.

**1a. One exported field constant per cloud collection**, compile-time bound to the type it mirrors:

```ts
export const SUMMARY_CLOUD_FIELDS = {
  documentId: true, summary: true, tone: true, frequentWords: true,
  // …every key…
} satisfies Record<keyof AIDocumentSummary, true>;
```

`satisfies Record<keyof T, true>` makes `tsc` fail the moment a field is added to the interface and not to the constant. Do this for the summary, embedding, draft (`DRAFT_CLOUD_FIELDS` already exists — convert it), document, version and user-profile payloads. Where the client sends a payload rather than the whole record (embeddings build an explicit object in `saveEmbeddingToCloud`), bind the constant to *that* object's type.

**1b. A contract test** that parses `firestore.rules`, extracts each `hasOnly([...])` list, and asserts **set equality** with the matching constant. Report the difference in both directions — a field the rule lacks and a field the rule allows but nothing sends are both bugs worth naming. Plain string parsing is fine; do not add a rules-language parser dependency.

**1c. Generated maximal-document emulator tests.** For each collection, build a document containing **every** field from the constant and assert it is accepted, in both shapes:
- plaintext (encryption off),
- encrypted — `maybeEncrypt` turns the `STRING_FIELDS` into ciphertext and JSON-stringifies each `ARRAY_FIELD` into a single ciphertext string, so arrays arrive as **strings**. Take the field lists from the services rather than restating them.

Keep the existing hand-written cases; they cover rejection paths the generated ones do not.

## Part 2 — bound every cloud write loop

`tryReserveWriteBudget` / `tryReserveSummarizeBudget` / `areCloudWritesBlockedToday` currently guard **only** `AIEmbeddingService` and `AISummaryService`. The loops that write the most are unguarded:

- `encryptMigration.ts` — four batch loops (documents, versions ×2, drafts) at lines ~124, ~137, ~190, ~246. A migration over a full corpus is exactly the shape that exhausts a daily quota.
- `CloudSyncService.ts` — `Promise.all(versions.map(limiter(…)))` at ~136 and ~206, plus the surrounding document writes. `limiter` bounds *concurrency*, not the daily total.

For each loop:
1. Check `areCloudWritesBlockedToday()` before starting; return a "deferred" result if set.
2. Reserve from a daily budget per write, and stop cleanly when it is spent — leaving the remaining work for the next day, never dropping it.
3. On a failure where `isGlobalWriteFailure(err)` is true (`resource-exhausted`, `permission-denied`), call `blockCloudWritesToday()` and **abort the whole loop**. These are properties of the project or the schema; every remaining write fails identically.
4. Per-record failures (oversize, `ENCRYPT_REQUIRED`) keep their existing per-record handling. Blocking the day over one bad document would be worse than the bug.

Surface the state: the user should be able to see "cloud writes paused until tomorrow" somewhere in sync diagnostics rather than only in the error log.

## Acceptance criteria

- Adding a field to `AIDocumentSummary` (or any covered type) without updating the constant fails `tsc`; updating the constant without updating `firestore.rules` fails the contract test. Demonstrate both.
- A document containing every field from each constant is accepted by the rules, encrypted and plaintext.
- No bulk cloud-write loop can run unbounded: each one stops on a spent budget and aborts on a global failure.
- A forced `permission-denied` in a bulk loop produces **one** report and one stop, not one per record.

## Process (please follow — these have all bitten this repo)

- Run the **full** suite, not just the files you touched: `npx vitest run` at the root and in `functions/`. Two pre-existing tests were left failing by an earlier contract change and reported as "all tests pass".
- Run `npm run lint` (root, `NODE_OPTIONS=--max-old-space-size=8192`). Refactors here have repeatedly left orphaned imports, and CI uses `--max-warnings 0`.
- Rules tests need the emulator: `cd functions && npm run test:rules` (needs `JAVA_HOME` from brew openjdk).
- **Verify every new test is non-vacuous**: revert the fix it covers, confirm that exact test fails, restore. A test that passes against the broken code proves nothing — this has already happened once here, on a test I wrote myself.
- Do not weaken a rule to make a test pass. If a cap is wrong, derive the new value from the client's own limit and say where it came from.
