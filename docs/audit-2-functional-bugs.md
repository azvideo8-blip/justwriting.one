# Functional Bug Audit — July 2026 (Round 2)

Self-contained. Prefix: `BUG-`. Source: full functional audit of core services and AI pipeline (2026-07-08), after SEC-1..9 fixes landed. Severity: 🔴 Critical / 🟠 High / 🟡 Medium / 🔵 Low.

---

## BUG-1 — Document deletion doesn't clean up AI data — orphaned summaries and embeddings accumulate forever 🔴

**Context:** `src/core/services/LocalDocumentService.ts:94–107`, `src/core/services/DocumentService.ts:166–185`, `src/features/archive/services/archiveCrud.ts:139–148`

When a document is deleted via `deleteArchiveSession` → `StorageService.deleteDocument` → `LocalDocumentService.deleteDocument` (local) and `DocumentService.deleteDocument` (cloud), neither path touches AI data:

- **Local:** `LocalDocumentService.deleteDocument` deletes the `documents` + `versions` IDB stores but never touches `aiSummaries` or `aiEmbeddings`. Verified by grep — `AISummaryService.delete` and `AIEmbeddingService.delete` are never called from any delete code path.
- **Cloud:** `DocumentService.deleteDocument` batch-deletes `versions/{id}` subcollection docs and the parent document, but leaves `users/{userId}/summaries/{documentId}` and `users/{userId}/embeddings/{documentId}` untouched in Firestore.

Effect: every deleted document leaves two orphaned Firestore docs (summary + embedding) and two orphaned IDB entries. With Firestore's free-tier daily write quota and paid storage, these accumulate silently forever.

**Tasks:**
1. In `archiveCrud.ts:deleteArchiveSession`, after `StorageService.deleteDocument`, add:
   ```ts
   await AISummaryService.delete(session.id);
   await AIEmbeddingService.delete(session.id);
   ```
   Use the local document ID as key (both stores key by `documentId`).
2. In `DocumentService.deleteDocument` (cloud), inside the final batch or after it, add:
   ```ts
   const { doc: docRef } = mod;
   finalBatch.delete(docRef(db, 'users', userId, 'summaries', documentId));
   finalBatch.delete(docRef(db, 'users', userId, 'embeddings', documentId));
   ```
   These deletions are safe even if the docs don't exist (Firestore no-ops on missing deletes in batches).
3. Add a migration / one-time cleanup script (optional, low priority) for already-orphaned data.

**Acceptance:** Deleting a document removes its entries from `aiSummaries`, `aiEmbeddings` (local IDB) and `summaries/{id}`, `embeddings/{id}` (Firestore). Confirmed by checking IDB counts and Firestore before/after a delete.

---

## BUG-2 — `maybeEncrypt(..., true)` silently prevents AI data from ever syncing to cloud for non-encrypted users 🟠

**Context:** `src/features/ai/services/AISummaryService.ts:14–21`, `src/features/ai/services/AIEmbeddingService.ts:34`, `src/features/ai/services/AIProfileService.ts:18–22`, `src/core/services/CloudSyncService.ts:378–384`, `src/core/crypto/cryptoHelpers.ts:28–55`

Four call sites pass `true` as the `userIdOrRequired` argument to `maybeEncrypt`:

```ts
// In AISummaryService, AIEmbeddingService, AIProfileService, CloudSyncService:
const encrypted = await maybeEncrypt({ ...payload }, fields, arrayFields, true);
```

`maybeEncrypt` with `true` sets `required = true` and `shouldEncrypt = true`. If `getSessionKey()` returns `null` (because no E2E session is active — either the vault is locked OR the user never enabled encryption), it throws `ENCRYPT_REQUIRED`. The callers catch this silently, so for non-encrypted users, every cloud save of AI summaries, embeddings, and AI portrait silently fails — data stays local-only and is lost if IndexedDB is cleared.

The correct distinction (from `maybeEncrypt` signature): pass `userId` (string) to conditionally encrypt only if the user has enabled E2E; pass `true` only when you want to encrypt-or-throw regardless of user preference (i.e. for servers, not clients). The AI data services should pass `userId` so non-encrypted users get their data synced unencrypted.

**Tasks:**
1. In `AISummaryService.saveSummaryToCloud(userId, summary)`: change `maybeEncrypt(..., true)` to `maybeEncrypt(..., userId)`.
2. In `AIEmbeddingService.saveEmbeddingToCloud(userId, emb)`: same change.
3. In `AIProfileService.savePortrait`: change `maybeEncrypt(..., true)` to `maybeEncrypt(..., uid)` where `uid` is the current user's UID.
4. In `CloudSyncService.syncPortraitToCloud(userId)`: change `maybeEncrypt(..., true)` to `maybeEncrypt(..., userId)`.
5. Update `ENCRYPT_REQUIRED` catch blocks in the callers: after the change, `ENCRYPT_REQUIRED` should only be thrown for encrypted users with a locked vault (not for non-encrypted users), so the log message can be more precise.

**Acceptance:** A user without E2E encryption enabled can save a document, get an AI summary, and see it sync to Firestore. A user WITH E2E enabled but a locked vault still gets `ENCRYPT_REQUIRED` and queues for later.

---

## BUG-3 — `ConflictResolver` sets forked document's `firstSessionAt` to the current session's start, losing history 🟠

**Context:** `src/core/services/ConflictResolver.ts:17–23`

When a sync conflict is detected (cloud version ≥ local new version), the resolver forks the local changes into a new document:

```ts
const forkedDocId = await LocalStorageService.createDocument(userId, {
  title: conflictTitle,
  tags: data.tags,
  labelId: data.labelId,
  firstSessionAt: data.sessionStartedAt.getTime(),  // ← current session start
  lastSessionAt: Date.now(),
});
```

`data.sessionStartedAt` is the conflicting session's start time, not the original document's first session time. For a document created months ago, the forked copy shows a `firstSessionAt` equal to the date of the conflict, not the original creation date. Writing streaks, session history charts, and "first session" metadata are all wrong for the forked document.

**Tasks:**
1. Pass the original document's `firstSessionAt` into `resolveConflict`. The caller in `CloudSyncService.syncVersionToCloud` has access to the local document via `documentId` — fetch it before calling `ConflictResolver.resolveConflict` and pass `localDoc.firstSessionAt`.
2. Update the `resolveConflict` signature to accept `originalFirstSessionAt?: number`:
   ```ts
   async resolveConflict(
     userId, documentId, linkedCloudId, data, newVersion, cloudDoc,
     originalFirstSessionAt?: number
   )
   ```
3. Use `originalFirstSessionAt ?? data.sessionStartedAt.getTime()` as `firstSessionAt` in `createDocument`.

**Acceptance:** A forked document created from a conflict has the same `firstSessionAt` as the original document, not the conflict date.

---

## BUG-4 — `LocalDocumentService.updateAfterSession:55` sets `sessionsCount` to `currentVersion` instead of incrementing 🟠

**Context:** `src/core/services/LocalDocumentService.ts:55`

```ts
await tx.objectStore('documents').put({
  ...existing,
  totalWords: data.totalWords,
  totalDuration: data.totalDuration,
  currentVersion: data.currentVersion,
  sessionsCount: data.currentVersion,  // ← should be (existing.sessionsCount || 0) + 1
  lastSessionAt: now,
  mood: data.mood,
});
```

`sessionsCount` is set to the version number, not to the incremented session count. Currently this is only called with `currentVersion = 1` (from `LocalStorageService.saveNew` and `ConflictResolver.resolveConflict`), so it coincidentally produces the correct value of 1. But:

1. The profile update 5 lines below uses this value: `sessionsCount: profile.sessionsCount - (existing.sessionsCount || 0) + data.currentVersion` — the formula is correct only when `data.currentVersion = 1`.
2. If `updateAfterSession` is ever called with `currentVersion > 1` (e.g., future code path, migration, or import), profile stats silently corrupt.

Compare with `LocalStorageService.saveVersionToLocal:79` which correctly uses `(existing.sessionsCount || 0) + 1`.

**Tasks:**
1. Change line 55 to:
   ```ts
   sessionsCount: (existing.sessionsCount || 0) + 1,
   ```
2. Update the profile formula on line 66 accordingly (it currently uses `data.currentVersion` as the delta; after this fix it should use `1`):
   ```ts
   sessionsCount: profile.sessionsCount - (existing.sessionsCount || 0) + 1,
   ```

**Acceptance:** `updateAfterSession` increases `sessionsCount` by exactly 1 each time, regardless of the version number. Existing unit tests for profile updates pass.

---

## BUG-5 — `summarizeDocument` and `embedDocument` have no per-user limit; bulk analysis can exhaust the global budget for all users 🟡

**Context:** `functions/src/ai/summarizeDocument.ts:63–65`, `functions/src/ai/embedDocument.ts:44–47`

Both functions explicitly skip per-user limits (`checkAndIncrementLimit` / `checkRateLimit`), guarded only by `tryReserveGlobalRequest` (10,000 req/day shared across all users). The comments acknowledge this as intentional ("background infrastructure"). However:

- `useEmbeddingIndexer` on the client runs embedding on every document whenever the model changes or content changes. With 100+ documents, this fires 100+ requests in one session, consuming 1% of the global daily budget per user per model update.
- If a user manually triggers "Re-analyze all" (DiagnosticsPage), every document triggers both `summarizeDocument` AND `embedDocument` — 2 × N global slots for N documents.
- There's no per-session or per-user daily cap on these calls.

**Tasks:**
1. Add a client-side per-day per-user cap for background summarize/embed calls. Reuse the `tryReserveWriteBudget` pattern already in `AIEmbeddingService` — add a parallel `tryReserveSummarizeBudget` or share the same budget across both.
2. In `useEmbeddingIndexer`, cap the number of embedding requests per session (e.g., max 20 documents per session, resume on next open). Already has a `DAILY_LIMIT` constant — enforce it against a persistent daily counter, not just a session limit.
3. Optionally add a server-side per-user rolling 1-hour cap for summarize/embed (e.g., `aiInfraLimit/{uid}` counter) distinct from the chat daily limit.

**Acceptance:** A single user triggering "re-index all" on 200 documents uses at most N global slots (configurable cap), not 200 × 2 slots in one session.

---

## BUG-6 — `StorageService.LockManager` executes `fn()` even when the predecessor rejected 🟡

**Context:** `src/core/services/StorageService.ts:17–19`

```ts
const next = prev.then(
  async () => { result = await fn(); },  // success handler
  async () => { result = await fn(); },  // rejection handler — also calls fn()!
);
```

Both the success and rejection handlers call `fn()`. The intent is to serialize document saves — if the previous save fails (e.g. `QuotaExceededError`), the next save still runs. But this creates a problem when storage quota is exceeded:

1. Save A → `QuotaExceededError` → `fn` throws
2. Save B queued → rejection handler fires → `fn` called again → same `QuotaExceededError`
3. Save C → same cycle

Each failure triggers the next attempt immediately, creating a retry flood until the queue drains or the app reloads. There's no backoff, no stop condition, and each attempt logs an error.

**Tasks:**
1. Change the rejection handler to re-throw instead of calling `fn()`:
   ```ts
   const next = prev.then(
     async () => { result = await fn(); },
     async (prevErr) => { throw prevErr; },  // propagate; don't retry
   );
   ```
   This means a failed save blocks subsequent saves for the same document until the lock is released (which it is in `finally`), so they do still run — but only after the current chain's error propagates, not in the same microtask cycle.
2. Alternatively, if the intent is "skip failed predecessors and keep going," document this explicitly and add a configurable retry cap.

**Acceptance:** A `QuotaExceededError` on one save does not immediately trigger the next save attempt. The error surfaces to the caller and the user sees a storage-full warning.

---

## BUG-7 — `SyncService.addToQueue` reads then writes without a transaction — duplicate entries possible under concurrent calls 🟡

**Context:** `src/core/services/SyncService.ts:13–25`

```ts
const existing = await db.getAll('syncQueue');              // read
const hasRecent = existing.some(item => item.documentId === documentId && ...);
if (hasRecent) return;
await db.put('syncQueue', { id: `sync_${documentId}_${Date.now()}`, ... }); // write
```

Two concurrent `addToQueue(sameDocId)` calls both read an empty queue, both find no recent entry, and both write — creating duplicate entries. These are benign (both result in a sync attempt for the same document), but they double the work and can cause spurious "sync pending" counts in the UI.

**Tasks:**
1. Wrap both the read and the write in a single IDB transaction:
   ```ts
   const tx = db.transaction('syncQueue', 'readwrite');
   const all = await tx.store.getAll();
   const cutoff = Date.now() - 60_000;
   const hasRecent = all.some(item => item.documentId === documentId && item.createdAt >= cutoff);
   if (!hasRecent) {
     await tx.store.put({ id: `sync_${documentId}_${Date.now()}`, documentId, type: 'document', createdAt: Date.now() });
   }
   await tx.done;
   ```

**Acceptance:** Concurrent `addToQueue` calls for the same document result in exactly one queue entry.

---

## BUG-8 — `sw.js` cache version is `v0.7.42` but app is at `v0.7.45` — old cached assets never evicted 🔵

**Context:** `public/sw.js:2`, `package.json:4`

```js
const CACHE_VERSION = 'v0.7.42';  // app is 0.7.45
```

The service worker's activate handler evicts all caches whose name isn't `jw-v0.7.42` or `jw-nav-v0.7.42`. Because the cache name hasn't changed across 3 releases, old cached assets from v0.7.42 accumulate alongside new assets in the same cache bucket. No eviction runs, so the cache grows unboundedly.

This isn't currently serving wrong content (Vite content hashes ensure new assets have new filenames and aren't shadowed by old ones), but:
- Old asset blobs from 3 versions ago remain in the browser's cache storage.
- The cache size grows with every release that skips a version bump.

**Tasks:**
1. Bump `CACHE_VERSION` to `'v0.7.45'` in `public/sw.js`.
2. Add a process rule (in CLAUDE.md or release checklist) to bump `CACHE_VERSION` with every release that changes JS/CSS assets.

**Acceptance:** After the bump, users' browsers evict `jw-v0.7.42` and `jw-nav-v0.7.42` caches on the next SW activation. Cache size reflects only the current release's assets.

---

## BUG-9 — `extractChatMemory.ts` builds `conversationText` before the injection check 🔵

**Context:** `functions/src/ai/extractChatMemory.ts:50–56`

```ts
// Line 50: conversationText built first
const conversationText = parsed.data.messages
  .map(m => `${m.role}: ${sanitizeAiInput(m.content)}`)
  .join('\n\n');

// Line 54: injection check runs AFTER
if (parsed.data.messages.some(m => hasInjectionAttempt(m.content))) {
  throw new HttpsError('invalid-argument', 'Disallowed patterns in messages.');
}
```

The injection check correctly blocks malicious input before the AI call, so there's no security regression. But `sanitizeAiInput` is applied to build `conversationText` before `hasInjectionAttempt` runs on the raw content. Since `sanitizeAiInput` strips template tokens but doesn't strip injection phrases, `hasInjectionAttempt` on raw content is what actually catches them. The order is logically inverted: check first, then build.

**Tasks:**
1. Move the injection check to before `conversationText` construction:
   ```ts
   if (parsed.data.messages.some(m => hasInjectionAttempt(m.content))) {
     throw new HttpsError('invalid-argument', 'Disallowed patterns in messages.');
   }
   const conversationText = parsed.data.messages
     .map(m => `${m.role}: ${sanitizeAiInput(m.content)}`)
     .join('\n\n');
   ```

**Acceptance:** Injection check fires before any string processing. No behavioral change — just defensive code ordering.

---

## BUG-10 — `VersionService.addVersion` is not idempotent — network retries create duplicate version numbers in Firestore 🔵

**Context:** `src/core/services/VersionService.ts:27–63`, `src/core/services/CloudSyncService.ts:311–345`

`VersionService.addVersion` uses `addDoc` (auto-generated ID) without checking whether a version with the same `versionNumber` already exists for the document. Firestore `addDoc` is not idempotent — a network timeout where the write succeeded but the response was lost causes the caller to retry and create a second document with the same `version` field value.

`getVersions` (line 65–88) sorts by `version` and returns all, so the duplicate appears twice in the version list. `CloudSyncService.addCloudCopy` deduplicates via `cloudNums = new Set(cloudVersions.map(v => v.version))` before batch-uploading, but the initial `syncVersionToCloud` path does not check for duplicates before calling `addVersion`.

**Tasks:**
1. In `syncVersionToCloud` (CloudSyncService), before calling `VersionService.addVersion`, fetch the latest cloud version and verify `cloudDoc.currentVersion < newVersion` — already done, so the check exists. But add a secondary guard: if `addVersion` is going to be called and a version doc with `version = newVersion` already exists (e.g. queried from `getVersions`), skip the write.
2. Alternatively, use a deterministic Firestore document ID (e.g., `${documentId}_v${versionNumber}`) with `setDoc` instead of `addDoc` to make the write idempotent by nature. This is the correct long-term fix.

**Acceptance:** Retrying a failed `addVersion` call (same version number, same document) does not create a duplicate Firestore document. `getVersions` returns each version number exactly once.

---

## Not doing (explicitly excluded from this round)

- **Re-architecting the per-user vs. global budget separation for AI infra calls** — known design decision; embed/summarize are intentionally not user-quota-gated. BUG-5 proposes a client-side cap only.
- **Replacing `addDoc` with deterministic IDs across all of Firestore** — larger refactor than BUG-10 warrants; fix only `addVersion` first.
- **Rewriting LockManager** — BUG-6 fix is a one-line change in the rejection handler only.
