# Pre-Migration Fixes — July 2026

Bugs to fix before VPS/Supabase migration this month. All others (BUG-2, 5, 9, 10, cloud half of BUG-1) are Firebase/Vercel-specific and will disappear with the migration. Prefix: `PMF-`.

---

## PMF-1 — Document deletion leaves orphaned AI data in local IndexedDB forever 🔴

**Source:** BUG-1 (local part only — cloud Firestore cleanup can wait for migration)

**Context:** `src/features/archive/services/archiveCrud.ts:139–148`, `src/core/services/LocalDocumentService.ts:94–107`

`deleteArchiveSession` → `StorageService.deleteDocument` → `LocalDocumentService.deleteDocument` deletes `documents` + `versions` from IndexedDB but never touches `aiSummaries` or `aiEmbeddings`. Every deleted document leaves two orphaned IDB entries. These accumulate silently and will bloat the export during migration data transfer.

**Fix:**
In `archiveCrud.ts:deleteArchiveSession`, after the `StorageService.deleteDocument` call:
```ts
import { AISummaryService } from '../../ai/services/AISummaryService';
import { AIEmbeddingService } from '../../ai/services/AIEmbeddingService';

// inside deleteArchiveSession, after StorageService.deleteDocument:
const docId = session._isLocal ? session.id : (session._linkedCloudId || session.id);
await AISummaryService.delete(docId).catch(() => {});
await AIEmbeddingService.delete(docId).catch(() => {});
```

Use `session.id` for local docs, `session._linkedCloudId || session.id` for cloud-linked docs (same key used by AI services to store by documentId).

**Acceptance:** After deleting a document, its entries are gone from `aiSummaries` and `aiEmbeddings` IDB stores. IDB entry count for those stores doesn't grow after a delete cycle.

---

## PMF-2 — `ConflictResolver` stamps forked document with conflict date instead of original `firstSessionAt` 🟠

**Source:** BUG-3

**Context:** `src/core/services/ConflictResolver.ts:17–23`, called from `src/core/services/CloudSyncService.ts:309`

```ts
// ConflictResolver.ts:21
firstSessionAt: data.sessionStartedAt.getTime(),  // current session's start, not document's first
```

A document written months ago that hits a sync conflict gets a forked copy with `firstSessionAt` = today. Writing stats and timeline are wrong. Data will migrate with wrong timestamps.

**Fix:**
1. In `CloudSyncService.syncVersionToCloud`, fetch the local doc before calling `resolveConflict`:
   ```ts
   // CloudSyncService.ts — before ConflictResolver.resolveConflict call
   const localDb = await getLocalDb();
   const localDoc = await localDb.get('documents', documentId);
   const originalFirstSessionAt = localDoc?.firstSessionAt;
   ```
2. Pass it to `resolveConflict`:
   ```ts
   // ConflictResolver signature
   async resolveConflict(
     userId, documentId, linkedCloudId, data, newVersion, cloudDoc,
     originalFirstSessionAt?: number
   )
   // inside createDocument call:
   firstSessionAt: originalFirstSessionAt ?? data.sessionStartedAt.getTime(),
   ```

**Acceptance:** Forked document's `firstSessionAt` matches the original document's first session timestamp.

---

## PMF-3 — `updateAfterSession` sets `sessionsCount` to version number, not session count 🟠

**Source:** BUG-4

**Context:** `src/core/services/LocalDocumentService.ts:55`, `src/core/services/LocalDocumentService.ts:66`

```ts
sessionsCount: data.currentVersion,  // line 55 — wrong
// profile update, line 66:
sessionsCount: profile.sessionsCount - (existing.sessionsCount || 0) + data.currentVersion,
```

Currently only called with `currentVersion = 1` so harmless, but semantically incorrect and will corrupt stats if ever called with version > 1. Migrating corrupt data is worse than fixing it now.

**Fix:**
```ts
// line 55:
sessionsCount: (existing.sessionsCount || 0) + 1,

// line 66:
sessionsCount: profile.sessionsCount - (existing.sessionsCount || 0) + 1,
```

**Acceptance:** `updateAfterSession` increments `sessionsCount` by 1 regardless of `currentVersion`. Unit test: call twice on same doc → sessionsCount = 2.

---

## PMF-4 — `LockManager` retries `fn()` immediately when predecessor rejected — flush loop on QuotaExceeded 🟡

**Source:** BUG-6

**Context:** `src/core/services/StorageService.ts:17–19`

```ts
const next = prev.then(
  async () => { result = await fn(); },
  async () => { result = await fn(); },  // rejection handler also calls fn()
);
```

When storage is full, first save fails → rejection handler fires → fn() called again → also fails → next in queue also fires immediately → flood of errors with no backoff.

**Fix — one line:**
```ts
const next = prev.then(
  async () => { result = await fn(); },
  async (prevErr) => { throw prevErr; },  // propagate error, don't retry
);
```

**Acceptance:** A `QuotaExceededError` on one save propagates to the caller without triggering subsequent saves in the same microtask cycle. Each save attempt is independent (via the lock queue), not cascaded.

---

## PMF-5 — `SyncService.addToQueue` read-then-write without IDB transaction — duplicates under concurrent calls 🟡

**Source:** BUG-7

**Context:** `src/core/services/SyncService.ts:13–25`

Two concurrent autosave triggers for the same document both read an empty queue and both enqueue — resulting in double sync attempts and inflated pending counts in the UI.

**Fix:**
```ts
async addToQueue(documentId: string): Promise<void> {
  const db = await getLocalDb();
  const cutoff = Date.now() - 60_000;
  const tx = db.transaction('syncQueue', 'readwrite');
  const all = await tx.store.getAll();
  const hasRecent = all.some(item => item.documentId === documentId && item.createdAt >= cutoff);
  if (!hasRecent) {
    await tx.store.put({
      id: `sync_${documentId}_${Date.now()}`,
      documentId,
      type: 'document' as const,
      createdAt: Date.now(),
    });
  }
  await tx.done;
},
```

**Acceptance:** Concurrent calls to `addToQueue` with the same documentId result in exactly one queue entry.

---

## PMF-6 — `sw.js` CACHE_VERSION is `v0.7.42`, app is `v0.7.45` — stale assets not evicted 🔵

**Source:** BUG-8

**Context:** `public/sw.js:2`, `package.json:4`

The activate handler evicts caches whose name doesn't match the current version. Since the name hasn't changed in 3 releases, old v0.7.42 assets live alongside new ones indefinitely. Already added to the release checklist in CLAUDE.md — just needs the immediate fix.

**Fix:**
```js
// public/sw.js line 2:
const CACHE_VERSION = 'v0.7.45';
```

**Acceptance:** After SW update, old `jw-v0.7.42` and `jw-nav-v0.7.42` caches are evicted from users' browsers on next activation.
