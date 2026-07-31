# AG-READ-1..5 — the daily READ quota, not the write quota

**Context (2026-07-31).** Firebase console, free-tier database, one user:

| limit | value | used |
|---|---|---|
| Free daily **read** units per project | 50,000 | **65,073 — 100%+** |
| Free daily **write** units per project | 40,000 | 9,188 — 23% |

Every guard this project has built — `writeBudget.ts`, the bulk budget, `blockCloudWritesToday`, the per-service daily caps — counts **writes**. Nothing counts reads, and reads are what is being exhausted. The write side is healthy at a quarter of its allowance; the read side went over before noon.

These tickets are ordered by how many reads they burn. AG-READ-1 alone can account for the whole overage.

**Immediate mitigation for the owner, before any of this ships:** close the app tab. The read burn in AG-READ-1 requires the app to be open; the quota resets at 00:00 Pacific.

---

## AG-READ-1 — the restore pass re-lists the entire notes collection every 2 minutes

**Priority:** P0 · single largest read consumer · Scope: Medium
**Files:** `src/features/ai/hooks/useEmbeddingIndexer.ts`, `src/core/services/CloudSyncService.ts`, new `src/core/firebase/readBudget.ts`.

### Why

`useEmbeddingIndexer` polls every `POLL_INTERVAL_MS = 120_000` for as long as the app is open. Each pass, while `restoredRef.current` is false, runs:

```
CloudSyncService.restoreMissingDocuments(uid)
  └── DocumentService.getUserDocuments(uid)   ← reads EVERY document in the collection
        └── per unrestored doc: getDocument (1) + VersionService.getVersions (all versions)
```

`restoredRef` is only set once the pass completes cleanly:

```ts
if (!aiRestored.skippedLocked && !hasMore) restoredRef.current = true;
```

So whenever the pass cannot finish, the flag stays false and the **whole collection is listed again 120 seconds later, forever**. Three ordinary states keep it from finishing:

1. **Locked vault.** `restoreAIDataFromCloud` returns `skippedLocked` without reading — correct. But `restoreMissingDocuments` runs *before* it with no such guard, lists everything, and then fails per note inside `addLocalCopy` when `maybeDecrypt` throws `LOCKED`. It restores nothing and pays full price, every pass.
2. **Spent bulk budget** (`hasMore: true`) — by design, but it also means "re-list every 2 minutes for the rest of the day".
3. **Notes that are unlinked** (2026-07-30 incident): every cloud document looks missing, so every pass tries to download the entire library.

At ~120 notes that is ~120 reads per pass minimum, 30 passes an hour — **~3,600 reads/hour, ~86,000/day** from an idle open tab, before a single note is opened. `getUserDocuments` is not covered by any budget: `tryReserveBulkWriteBudget` is only consulted *inside* the per-note loop, after the listing has already been paid for.

### Fix

- **Skip the pass entirely when the vault is locked.** Hoist the `getEncryptionEnabled(userId) && !getSessionKey()` check that `restoreAIDataFromCloud` already uses, and apply it to `restoreMissingDocuments` too — a pass that cannot decrypt anything must not read anything.
- **Rate-limit the listing itself.** Persist the last successful listing time in `localStorage` (not a per-mount ref) and refuse to re-list more often than every 30 minutes. A page reload must not reset it — today every reload starts the cycle over.
- **Persist "done" per day, not per session.** When a pass completes with nothing left to restore, record that for the rest of the quota day.
- **Introduce `readBudget.ts`**, mirroring `writeBudget.ts`: a daily cap on *collection listings* (`getUserDocuments`, `getVersions`, the `summaries` and `embeddings` collections in `AIRestoreService`). Charge the listing its actual document count, not one unit. When the cap is spent, background passes stop and log one activity entry — the same fail-safe shape as `areCloudWritesBlockedToday()`.
- Do **not** make the poll interval longer as the fix. That trades one arbitrary number for another and still re-lists forever.

### Acceptance criteria

- With a locked vault and the app open for an hour, the restore pass performs **zero** Firestore reads.
- With an unlinked or partially restored library, the collection is listed at most twice an hour, and at most a bounded number of times per day.
- A page reload does not reset the listing rate limit.
- When the read budget is spent, the pass stops and says so in the activity log, in the tone of the existing entries.

### Tests

- Locked vault: no `getUserDocuments` call at all.
- `hasMore: true` does not cause a second listing within the rate-limit window; it does after it.
- Rate-limit state survives a simulated reload (fresh hook mount, same `localStorage`).
- Read budget: charged per document returned; the pass stops when spent and resumes the next day.

---

## AG-READ-2 — sync diagnostics costs 2N reads and refetches everything after every click

**Priority:** P0 · this is what the owner had open during the incident · Scope: Small
**Files:** `src/features/settings/hooks/useSyncDiagnostics.tsx`.

### Why

`fetchData` reads the whole documents collection, and then, for **every** item that has a cloud copy:

```ts
await Promise.all(builtItems.map(async (item) => {
  if (item.hasCloud && item.cloudId) {
    const latest = await VersionService.getLatestVersion(userId, item.cloudId);
    item.cloudEncrypted = !!(latest as ...)?._encrypted;
  }
}));
```

One extra read per note, solely to colour an "encrypted" indicator. Cost per panel load: **2N reads**.

Worse, every single-item action ends with `await fetchData()` — `handleSyncItem`, `handleDownloadItem`, `handleUnlinkItem`, `handleEncryptItem`, `handleClearQueueItem`, `handleProcessDocument`. Working through a library one note at a time therefore costs 2N reads **per click**. At 120 notes that is 240 reads a click; a hundred clicks is 24,000 reads — half the daily allowance from one panel session.

### Fix

- Drop the bulk encryption probe. Resolve `cloudEncrypted` **lazily**, for a single row, when the user expands it or presses Encrypt — not for all N on load.
- After a single-item action, update **that row** in state instead of refetching the panel. Keep the full refetch on an explicit Refresh button.
- Do not automatically refetch on mount more than once; the panel is opened repeatedly during triage.

### Acceptance criteria

- Opening the panel costs one collection listing and nothing per note.
- Unlinking / syncing / downloading one note performs no collection listing.
- The encryption indicator still tells the truth for any row the user actually looks at.

### Tests

- Panel load calls `getLatestVersion` zero times.
- A single-item action does not call `getUserDocuments`.
- Row state after an action matches what a refetch would have produced.

---

## AG-READ-3 — the archive list reads a version per cloud-only note on every open

**Priority:** P1 · Scope: Small
**Files:** `src/features/writing/services/UnifiedSessionLoader.ts`.

### Why

`loadAllSessions` lists all cloud documents and then, for each cloud document with no local copy, fetches its latest version to fill `content` — one read per note, on top of the listing, **every time the archive is loaded**. When links are missing (AG-READ-1 point 3) that applies to the entire library.

### Fix

Do not fetch version content in the list path. The list needs title, dates, counts and tags — all of which live on the document. Load content when a note is actually opened. If some list feature genuinely needs the text (search, preview), state which, and fetch it for the visible page only.

Keep the existing `_locked` / `_decryptionError` / `_contentError` markers working: an unopened note is simply "not loaded yet", which must not be rendered as an error or as empty content.

### Acceptance criteria

- Opening the archive performs one collection listing and no per-note reads.
- Opening a single note loads its content.
- A locked vault still shows the note as locked, not as empty or broken.

### Tests

- Archive load calls `getLatestVersion` zero times.
- Opening a note fetches exactly one version.

---

## AG-READ-4 — every AI call reads the user profile twice, server-side

**Priority:** P1 · Scope: Small
**Files:** `functions/src/shared/aiUtils.ts`.

### Why

Per callable invocation:

- `isAdmin(uid)` reads `users/{uid}`.
- `getUserDailyLimit(uid)` reads `users/{uid}` **again**.
- `tryReserveGlobalRequest` reads up to 3 shard documents.

That is up to 5 reads per AI call, two of them of the *same* document — which now carries the full AI portrait markdown, so it is not a small document. Background passes make roughly 80–100 calls a day; chat, edit and the judge passes add more.

Note also that the owner's `role === 'admin'` makes `checkAndIncrementLimit` and `checkAndIncrementBulkLimit` return early, so **no server-side ceiling applies to background AI work at all** — the only brake is `AIBackgroundBudget` in browser `localStorage`, which is per-browser and vanishes if site data is cleared.

### Fix

- One read of `users/{uid}` per invocation: fetch once, derive both admin status and the daily limit from it.
- Memoise per function instance with a short TTL (60s is ample; a role change may lag by a minute).
- Reduce the shard search from 3 reads to 1 by starting at a random shard and only falling back once.
- Separately (write side, and cheap today at 23% but unbounded): `recordUsage` creates a **new document per request** in `aiUsage/{uid}/events`, with no TTL and no cleanup, read only by the admin breakdown view. Put it behind an env flag, default off.

### Acceptance criteria

- One `users/{uid}` read per AI call, and none at all within the memo window.
- Admin behaviour unchanged.
- With the events flag off, no per-request event document is written; the daily aggregate still updates.

### Tests

- Emulator: two calls inside the TTL produce one profile read.
- Admin and non-admin limit behaviour is unchanged (existing emulator tests must still pass).
- Events flag off → `aiUsage/{uid}/events` stays empty; daily counters still increment.

---

## AG-READ-5 — make read consumption visible

**Priority:** P2 · Scope: Small
**Files:** `src/features/ai/pages/DiagnosticsPage.tsx`, `src/features/ai/hooks/useDiagnosticsData.ts`, `src/core/firebase/readBudget.ts`.

### Why

The write budget is visible in Diagnostics. Reads are invisible, which is why this went unnoticed until the console showed 130%. The app should be able to answer "what has been reading today" without opening the Firebase console.

### Fix

Show today's read budget beside the write budget: units spent, cap, and a breakdown by caller (restore pass, archive load, diagnostics panel, AI restore). Add an activity-log entry when a background pass is skipped for read budget, matching the existing Russian phrasing.

### Acceptance criteria

- Diagnostics shows read consumption for the current quota day, broken down by caller.
- Skipping a pass for budget produces exactly one log entry, not one per attempt.

---

## Process (applies to all five)

Same as AG-BG-1:

- Full `npx vitest run` at the repo root **and** in `functions/`.
- `npm run lint` with `NODE_OPTIONS=--max-old-space-size=8192`. The full lint OOMs on this repo — lint the changed files individually if it does, and note that in the report. Do not pipe lint through `tail`: it masks the exit code.
- `npx tsc --noEmit`.
- **Verify every new test is non-vacuous**: revert its fix, confirm that exact test fails, restore.
- Attach the `tsc`, lint and both suite outputs to the report.

**Do not** change how notes link to their cloud copies (`linkedCloudId` semantics). A re-link pass landed on 2026-07-31 and is not yet deployed; touching that path in parallel will conflict.
