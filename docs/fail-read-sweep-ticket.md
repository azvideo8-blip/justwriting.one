# AG-SAFE-1 — sweep the class: a failed read must never be reported as an answer

**Priority:** P1 · the recurring worst bug class in this project · Scope: Medium
**Files:** `src/features/writing/hooks/useLifeLog.ts`, `src/features/ai/utils/noteRetriever.ts`, `src/features/ai/services/AIConsolidationService.ts`, `src/features/ai/services/AITaxonomyService.ts`, `src/features/ai/services/AIThemeLedgerService.ts`, `src/features/ai/hooks/useAIChat.ts`, plus a shared helper (new).

**Coordinate:** `src/core/services/CloudSyncService.ts` and `src/features/settings/hooks/useSyncDiagnostics.tsx` are being changed under AG-READ-1/AG-READ-2 at the same time. Do not edit those two here; if the sweep finds something in them, write it down in the report instead.

## Why

On 2026-07-29/30 **four separate places** interpreted "could not ask" as "the answer is no", each next to an action the user cannot undo. Each was fixed individually as it surfaced:

| site | what a failed read became | fixed in |
|---|---|---|
| `useEncryptionSetup` | "your vault is legacy" → offered an irreversible key re-wrap, in a modal with no exit | `22a939a5` |
| `useSyncDiagnostics` | `getUserDocuments().catch(() => [])` → "Cloud Copy Lost" beside **Unlink** | `3b387b25` |
| vault unlock | any non-`WrongPasswordError` → "something went wrong", read as "my password stopped working" | `3b387b25` |
| background AI passes | provider failure → next cluster, same 60s timeout, a 504 a minute | `446c5356` + `22a939a5` |

The owner unlinked their entire library on the second one. The mistake was fixing sites instead of the class. This ticket fixes the class.

## The rule

**Distinguish "no" from "no answer" at the point of the read, not in the UI.**

`.catch(() => [])` on a read is a bug whenever the empty result reaches a verdict. Three concrete requirements:

1. A function that reads data returns the failure alongside the data — `{ data, readFailed }`, or it throws. It must not hand a caller an empty array that is indistinguishable from a genuinely empty result.
2. No destructive or irreversible control may sit next to an unverified negative. When the state is unknown, the control is disabled and says why.
3. Unknown is its own state in the UI, distinct from empty. `UnifiedSessionLoader.loadAllSessions` already does this with `cloudLoadFailed`, and `useSyncDiagnostics` with its `cloud_unknown` status — **follow those two as the pattern**, do not invent a third shape.

## Sites found in the sweep

Confirmed instances, in priority order. Verify each before changing it — a catch that swallows a *write* failure, or a decrypt that legitimately means "wrong key" (`EncryptionService.verifyKey`), is **not** this class and must be left alone.

- **`useLifeLog.ts:45`** — `DocumentService.getUserDocuments(userId).catch(… return [])`. A failed cloud read silently produces a Life Log built from local documents only: days the user did write appear as days they did not. There is no "cloud unavailable" signal anywhere in this view. Highest impact of the remaining sites — this is the same shape as the bug that cost the library its links.
- **`noteRetriever.ts:78`** — `keywordSearch` returns `[]` when the index or the underlying read throws. The chat then answers from an empty retrieval, i.e. the assistant tells the user they never wrote about something because a lookup failed. The retriever must report the failure to the caller so the answer can say "I could not search your notes" instead of asserting absence.
- **`AIConsolidationService.getAllBeliefs` (:96, and the same shape at :148 and :185)** — `[]` on an IndexedDB failure, which renders as "the AI holds no beliefs about you". Same treatment.
- **`useAIChat.prepareAttachment` (:515)** — `null` on failure, which the UI presents identically to "this note has no text". Separate the two.
- **`AITaxonomyService.getStored` (:34)** and **`AIThemeLedgerService.getPendingThemeTouches` (:29)** — a `localStorage` parse failure reads as "nothing stored", which silently triggers a full re-derivation. Lower user-facing impact, but it spends AI calls and quota on a false premise. At minimum, log the difference.

Sweep for further instances rather than trusting this list to be complete: search for `.catch(` returning `[]`, `null`, `false`, `0` or `{}`, and for `catch` blocks that `return` an empty value, then ask of each — **does anything downstream conclude something about the user's data from this?** If yes, it belongs in this ticket. If no, leave it and say so.

## Acceptance criteria

- No read path in the listed files hands a caller an empty result that is indistinguishable from a failed one.
- The Life Log shows an explicit "cloud unavailable" state instead of quietly omitting cloud notes.
- Chat cannot state or imply that no notes exist on a search that failed.
- Every destructive control (Unlink, delete, migrate, re-wrap) is disabled while the relevant state is unknown, with a reason shown.
- No new UI vocabulary: reuse the existing "Облако недоступно" wording and the `cloud_unknown` pattern.

## Tests

For each converted site: a test where the read **rejects**, asserting that the caller receives the failure and that the UI renders the unknown state — not the empty state. A test that returns a genuinely empty result and asserts the empty state still renders. These two tests together are the point of the ticket; one without the other proves nothing.

Add one regression test per historical incident listed in the table above, if one does not already exist for it.

## Process

Same as AG-BG-1:

- Full `npx vitest run` at the repo root **and** in `functions/`.
- `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192`; the full run OOMs on this repo, so lint changed files individually if needed and say so in the report. Do not pipe lint through `tail` — it masks the exit code.
- `npx tsc --noEmit`.
- **Verify every new test is non-vacuous**: revert its fix, confirm that exact test fails, restore.
- Attach the `tsc`, lint and both suite outputs to the report.
