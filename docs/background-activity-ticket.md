# AG-BG-1 — automatic note sync + a visible log of every background process

**Priority:** P1 · the user currently cannot see what the app does on their behalf, only what fails · Scope: Large
**Files:** `src/core/services/CloudSyncService.ts`, `src/features/settings/hooks/useSyncDiagnostics.tsx`, `src/features/ai/hooks/useEmbeddingIndexer.ts`, `src/features/ai/services/AIRestoreService.ts`, `src/shared/errors/useErrorLogStore.ts`, `src/app/ErrorLogBadge.tsx`, `src/app/Sidebar.tsx` (the badge trigger), `src/core/firebase/writeBudget.ts`.

## Why

Two gaps, one root cause: background work is invisible unless it breaks.

**1. Notes do not come back on their own.** Signing out wipes every local store (SEC-29). Analysis is now restored automatically (`AIRestoreService`), but the **notes themselves** are not: `CloudSyncService.addLocalCopy` runs only from the per-note "Download" button in sync diagnostics. After a sign-out the user had to click it 118 times.

**2. The only window into background work is an error log.** `ErrorLogBadge` shows failures and nothing else. When the app is working, the user sees silence; when it fails, a wall of red. There is no way to answer "is it doing anything right now?" or "did that note actually reach the cloud?". Today that ambiguity cost hours: a total cloud-sync outage looked identical to normal operation.

This week produced four incidents where the honest signal existed only in devtools. The user asked for the opposite: show the work, not just the wreckage.

## Part 1 — automatic note sync

Add a restore pass that pulls **documents and versions** the way `AIRestoreService` pulls analysis:

- Runs after sign-in and on the same background schedule; reuses `addLocalCopy` per note so there is one code path, not two.
- **Bounded**: check `areCloudWritesBlockedToday()` first, reserve from the bulk budget per note, and stop cleanly when spent — the remainder continues next pass. A full corpus pull is exactly the shape that exhausted the daily quota twice on 2026-07-28.
- Idempotent: `addLocalCopy` already returns the existing local id when `linkedCloudId` matches, so re-running must not duplicate.
- Order newest-first so the notes the user is likely to want appear before the long tail.
- Leave the per-note Download button in place for anything the pass skipped.

## Part 2 — an activity log, not an error log

Generalise `useErrorLogStore` into an activity store. Keep the existing error entries as one severity, and add successful events.

**Events to record** (each with timestamp, outcome, and a one-line human description):
- note saved to cloud / restored from cloud
- note analysed by the AI, embedding built
- analysis restored from the cloud, analysis re-attached to its note
- theme ledger touched, belief published or rejected
- background pass started/finished with a count, budget spent, backoff engaged and until when

Записи на русском, в тон существующим сообщениям приложения («Заметка сохранена в облако», «Заметка обработана ИИ»).

**UI:**
- The sidebar badge shows **green** while background work is running or recently succeeded, red when the most recent entry is an error, neutral when idle. It is the same control — one place to look.
- The panel lists all entries newest-first with a severity filter (all / errors only).
- A **"Копировать"** button beside "Очистить", same behaviour as the one already in `ErrorLogBadge`: whole log to the clipboard, plain text, with a clipboard-API fallback.
- Cap the store (a few hundred entries, ring buffer) so a long session cannot grow it without bound.

**Do not** log per-keystroke autosave. One entry per completed operation, and collapse repeats the way the error log already does with its `count` field — otherwise the log becomes the noise it is meant to replace.

## Acceptance criteria

- After a sign-out and sign-in, notes and their analysis return with no manual clicking, and the pass stops on a spent budget instead of exhausting the daily quota.
- With everything healthy, the user can open the panel and see what happened and when, including successes.
- The badge is green during normal background work and red only when the newest entry is a failure.
- Copy puts the full log on the clipboard.
- A provider outage produces one entry plus a backoff notice, not one entry per retry (see `446c5356`).

## Tests

- Auto-sync: stops when the bulk budget is spent, does not duplicate an already-linked note, resumes on the next pass.
- Activity store: repeats collapse, ring buffer caps growth, severity derives the badge colour.
- **`useEmbeddingIndexer` has no test harness at all.** Stand one up as part of this ticket and cover the backoff branches, including `SERVER_ERROR` / `'error'` shipped untested in `446c5356`.

## Process

Same as AG-CLOUD-1: full `npx vitest run` at root and in `functions/`, `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192`, and **verify each new test is non-vacuous** by reverting its fix and confirming that exact test fails. Please attach the `tsc`, `lint` and both suite outputs to the report — three of the last reports claimed green on code that did not compile.
