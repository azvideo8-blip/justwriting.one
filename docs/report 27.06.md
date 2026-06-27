# Architecture Audit — Full Remediation Report

**Date:** 2026-06-27  
**Project:** justwriting-one v0.7.34  
**Auditor:** AI-assisted (5 parallel agents, AUDIT_PLAYBOOK.md + security-invariants.md)  
**Status:** 10 findings (0 Critical, 3 High, 4 Medium, 3 Low), CI green (typecheck, lint, 545/545 tests)

---

## Pre-flight

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS (0 errors) |
| `npm run lint` | PASS (0 errors, 0 warnings) |
| `npm run test:ci` | PASS (58 files, 545 tests, 0 failures) |
| `git status -sb` | Clean, `main...origin/main` |
| `git log --oneline -5` | v0.7.34 — security/reliability hardening (audit follow-up) |

---

## Section 1: Security (Functions + API + Firestore Rules)

| # | Check | Status |
|---|-------|--------|
| 1.1 | All callable functions check `request.auth` | **PASS** — 14/14 functions, all check `request.auth` as first statement |
| 1.2 | Admin functions verify admin role via Firestore | **PASS** — 5 admin functions read `users/{uid}` from Firestore, `setUserRole` uses transaction |
| 1.3 | No client-supplied flag bypasses rate limits | **PASS** — `callType` server-validated via `validateInternalCallRestrictions()` in `aiPolicy.ts:37-68` |
| 1.4 | `callType` internal calls restricted | **PASS** — maxTokens 256, maxMessages 3, noCustomPersona, noReasoning, noDocumentContent, noUserPortrait |
| 1.5 | Injection patterns on ALL user content | **FAIL** — see H-1 (Medium): `userPortrait` not checked |
| 1.6 | `sanitizeAiInput` on all content | **FAIL** — see M-1: `customSystemPrompt` and `userPortrait` not sanitized |
| 1.7 | `sanitizeAiResponse` on all model output | **PASS** — all Cloud Functions apply DOMPurify; streaming relies on client-side `rehype-sanitize` (documented) |
| 1.8 | `img` tags stripped from AI output | **PASS** — `MarkdownRenderer.tsx:9` allowlist excludes `img`; server-side `ALLOWED_TAGS: []` |
| 1.9 | `userId == request.auth.uid` in create validators | **PASS** — all document validators enforce; minor note on `isValidUserCreate` (see L-2) |
| 1.10 | `role`/`uid`/`email` not client-writable | **PASS** — blocked on update (line 162); `role` blocked on create (line 71) |
| 1.11 | `anonymizedTelemetry` create-only | **PASS** — `allow update, delete: if false` (lines 251-255) |
| 1.12 | No wildcard `allow read/write: if true` | **PASS** — no `if true` anywhere; `storage.rules` fully locked |
| 1.13 | No secrets, `.env*` gitignored | **PASS** — `.gitignore:7`; secrets via `process.env` + `secrets:` option |
| 1.14 | `enforceAppCheck` documented | **PASS** — documented in SECURITY.md, ARCHITECTURE.md, docs/api/ai-endpoints.md |

---

## Section 2: Race Conditions + Concurrency

| # | Check | Status |
|---|-------|--------|
| 2.1 | `tryReserveGlobalRequest` uses Firestore transaction | **PASS** — `aiUtils.ts:158-171`, `api/chat.ts:34-46` — `runTransaction()` atomic check-and-increment |
| 2.2 | `checkDailyLimit`/`checkRateLimit` use transactions | **PASS** — `aiUtils.ts:220,269`; `api/chat.ts:196,211` |
| 2.3 | No TOCTOU in global limit | **PASS** — emulator test `aiUtils.emulator.test.ts:97-111` (N=20 parallel at boundary) |
| 2.4 | IDB read-modify-write uses readwrite transactions | **PASS** — all `LocalDocumentService`, `AIDialogueService`, `LocalStorageService` mutations use transactions |
| 2.5 | `LockManager` serializes per-document saves | **PASS** — `StorageService.ts:10-29` — per-key promise chaining |
| 2.6 | `AIDialogueService` mutations use readwrite tx | **PASS** — all 10 mutation methods |
| 2.7 | `encryptMigration` concurrency guard | **PASS** — `_migrationInProgress` Set at `encryptMigration.ts:75` |
| 2.8 | `sendMessage` re-entrancy guard | **PASS** — `useAIChat.ts:422` — `if (isLoading) return null` |

---

## Section 3: Error Recovery + Refund

| # | Check | Status |
|---|-------|--------|
| 3.1 | `refundDailyLimit` in catch blocks | **FAIL** — see H-1: `api/chat.ts` has no `refundDailyLimit`; daily limit leaked on global-limit rejection |
| 3.2 | `refundGlobalRequest` in catch blocks | **FAIL** — see H-2: `api/chat.ts` non-reasoning `streamText` path has no error handler |
| 3.3 | `streamFireworksReasoning` try-catch around reader loop | **PASS** — `api/chat.ts:308,384-387` |
| 3.4 | `recordUsage` before `res.end()` | **PASS** — reasoning: `:394→:398`; non-reasoning: `onFinish` callback `:531-537` |
| 3.5 | `addLocalCopy` per-version decryption errors | **PASS** — `CloudSyncService.ts:50-57` — per-version try-catch, LOCKED re-thrown |
| 3.6 | `resetSession` after cleanup succeeds | **PASS** — `useWritingActions.ts:178-184` — cleanup → refresh → reset |
| 3.7 | `useDraftAutosave` 30s interval safety net | **PASS** — `useDraftAutosave.ts:82-88` |
| 3.8 | `firestoreClient._initPromise` resets on failure | **PASS** — `firestoreClient.ts:22-27`. **BUT** `firestore.ts._initPromise` does NOT reset — see H-3 |
| 3.9 | `firestore.ts` `online` event listener | **PASS** — `firestore.ts:91-95` |

---

## Section 4: Encryption + Vault

| # | Check | Status |
|---|-------|--------|
| 4.1 | `lockVault` doesn't call `setEncryptionEnabled(false)` | **PASS** — `useEncryptionStore.ts:115-118` — only clears `dataKey` + `isVaultUnlocked` |
| 4.2 | `maybeEncrypt` throws `ENCRYPT_REQUIRED` when locked | **PASS** — `cryptoHelpers.ts:51-53` — all 3 cloud write paths pass `userId` |
| 4.3 | `useEncryptionSetup` subscribes to `isVaultUnlocked` | **PASS** — `useEncryptionSetup.ts:22,98-107` — auto-lock → unlock prompt |
| 4.4 | Device key verified against verification ciphertext | **PASS** — `useEncryptionSetup.ts:44-68` — decrypt verification, mismatch → clear key |
| 4.5 | `keyVaultCache` uses `finally db?.close()` | **PASS** — all 3 functions: `:30-32`, `:48-50`, `:64-66` |
| 4.6 | `UnifiedSessionLoader` sets `cloudContent = ''` when locked | **PASS** — `UnifiedSessionLoader.ts:113-116` |
| 4.7 | `LegacyKeyMigration` nulls legacy fields | **PASS** — `LegacyKeyMigration.ts:59-64` (note: uses `null` not `deleteField()`, redundant with `saveEncryptionMeta`) |
| 4.8 | `saveEncryptionMeta` uses `deleteField()` | **PASS** — `EncryptionMetaService.ts:18-29` |
| — | Auto-lock timer (15 min, visibilitychange) | **PASS** — `useEncryptionStore.ts:5,38-83` |
| — | `getEncryptionEnabled` is persistent | **PASS** — localStorage-backed, not transient |

---

## Section 5: React Patterns + Performance

| # | Check | Status |
|---|-------|--------|
| 5.1 | Context values in `useMemo` | **FAIL** — see M-3: `ProfileContext.tsx:126` not memoized (AuthContext is fixed) |
| 5.2 | `useSessionFlow` return in `useMemo` | **PASS** — `useSessionFlow.ts:139-146` |
| 5.3 | `React.memo` not defeated by inline props | **FAIL** — see M-4: `DesktopWritingLayout.tsx:106-111` (WritingEditor fixed, WritingHeader not) |
| 5.4 | Zustand `useShallow` for multi-field selectors | **PASS** — `WritingFinishModal.tsx:75-88` |
| 5.5 | `console.error`/`console.warn` → `reportError` | **FAIL** — see L-1: 24 instances across 12 files |
| 5.6 | `useFocusTrap` MutationObserver `childList` only | **PASS** — `useFocusTrap.ts:34` |
| 5.7 | `useModalEscape` uses `stopImmediatePropagation` | **PASS** — `useModalEscape.ts:9` |
| 5.8 | `useCountUp` no reset to 0 on target change | **PASS** — `useCountUp.ts:5,20-22` |
| 5.9 | Timer pauses on unmount | **PASS** — `useBaseWritingSession.ts:130-136` |
| 5.10 | `useWpm` no zero on pause | **PASS** — `useWpm.ts:27-29` — only zeroes on `idle` |
| 5.11 | Error boundaries (outer + per-route + no Escape) | **PASS** — `AppRoutes.tsx:36-45`; `ErrorBoundary.tsx:55,109` — key remount, no Escape dismiss |

---

## Section 6: Data Integrity + IDB

| # | Check | Status |
|---|-------|--------|
| 6.1 | `saveVersionToLocal`: quota failure → throw | **PASS** — `LocalStorageService.ts:86-88` + `StorageService.ts:103-104` |
| 6.2 | Batch ops in single transaction | **PASS** — `clearLabelFromAllDocs`, `renameTagInAllDocs`, `removeTagFromAllDocs` |
| 6.3 | `collapseToLatest` in single transaction | **PASS** — `LocalVersionService.ts:64-69` |
| 6.4 | `updateAfterSession` incremental update | **PASS** — `LocalDocumentService.ts:45-73` — no full `getAll()` scan |
| 6.5 | `reconcileSessionsCount` in Diagnostics | **PASS** — `DiagnosticsPage.tsx:94` |
| 6.6 | `localDb` contains guards | **PASS** — v2-v8 all guarded |
| 6.7 | `localDb` `oldVersion < 4` placeholder | **PASS** — `localDb.ts:253-255` |
| 6.8 | Guest draft persists all fields | **PASS** — `draftPersistence.ts:15-44` |

---

## Section 7: PWA + Offline + SEO

| # | Check | Status |
|---|-------|--------|
| 7.1 | SW caches with `cache.put` | **PASS** — `sw.js:57-59` |
| 7.2 | SW registration `.catch()` + `controllerchange` | **PASS** — `inline-init.js:2` |
| 7.3 | `Cache-Control: no-cache` for `/sw.js` | **PASS** — `vercel.json:5-9` |
| 7.4 | `inline-init.js` default `'ru'` | **PASS** — `inline-init.js:1` |
| 7.5 | `og:image` PNG, absolute, with dimensions | **PASS** — `index.html:15-17` — 1200×630 PNG |
| 7.6 | `color-scheme: dark` meta | **PASS** — `index.html:30` |
| 7.7 | `x-default` hreflang | **PASS** — `index.html:10` |
| 7.8 | Offline banner on mobile + zen mode | **PASS** — `ConnectionStatusBanner.tsx:46` |
| 7.9 | `noscript` bilingual | **PASS** — `index.html:68` |
| 7.10 | `ErrorBoundary` retry uses key remount | **PASS** — `ErrorBoundary.tsx:55,109` |

---

## Section 8: AI Chat System

| # | Check | Status |
|---|-------|--------|
| 8.1 | Stream aborted on dialogue switch + unmount | **PASS** — `useAIChat.ts:334,339` |
| 8.2 | `sendMessage` re-entrancy guard | **PASS** — `useAIChat.ts:422` |
| 8.3 | `reader.releaseLock()` in finally | **PASS** — `useAIChat.ts:178-180` |
| 8.4 | Regenerate: new response in variants | **PASS** — `useAIChat.ts:1192,1206-1207` |
| 8.5 | Facet build: save new before deleting old | **PASS** — `AIProfileFacetService.ts:332-340` |
| 8.6 | `AIDialogueService` readwrite transactions | **PASS** — all 10 mutation methods |
| 8.7 | `MarkdownRenderer` strips `img` | **PASS** — `MarkdownRenderer.tsx:9` — allowlist, no `img` |
| 8.8 | AI daily limit midnight UTC reset | **PASS** — `useAiLimitStore.ts:54-58` |
| 8.9 | `documentContent` injection-checked | **PASS** — `api/chat.ts:487-489`; `chatWithAI.ts:92` |

---

## Security Invariants

| # | Invariant | Status |
|---|-----------|--------|
| 1 | Only server-validated `callType` skips per-user quota | **PASS** — `aiPolicy.ts:37-68` |
| 2 | Never write unencrypted content to cloud when vault locked | **PASS** — `cryptoHelpers.ts:51-53`; note: `encryptMigration.ts` guards upstream |
| 3 | `userId == request.auth.uid` in create validators; `role`/`uid`/`email` protected; telemetry create-only | **PASS** |
| 4 | All user-supplied content sanitized + injection-checked | **FAIL** — `userPortrait` and `customSystemPrompt` not fully sanitized (see M-1, M-2) |
| 5 | AI output sanitized — `img` stripped, no `rehype-raw` | **PASS** |

---

## Findings Detail

### H-1 — `api/chat.ts` missing `refundDailyLimit` (quota theft)

**Severity:** High  
**Files:** `api/chat.ts:464-469`

**Problem:** At line 464, `checkAndIncrementLimit(uid, reasoning)` increments the per-user daily counter. At line 469, if `tryReserveGlobalRequest()` returns false (project-wide limit reached), the handler returns 429 without refunding the daily limit. The user loses a daily slot for a request that was rejected at the global gate. Repeated global-limit rejections can exhaust the user's daily quota without a single successful AI call.

**Fix:** Add a `refundDailyLimit(uid)` function to `api/chat.ts` (mirror the Cloud Functions pattern) and call it before returning 429 at line 469. Also call it in the non-reasoning `streamText` error path (see H-2).

**Risk:** Minimal. The refund is best-effort (own try-catch). Only fires on rejection paths that currently burn quota silently.

---

### H-2 — `api/chat.ts` non-reasoning `streamText` path: no error handler, no refund

**Severity:** High  
**Files:** `api/chat.ts:526-540`

**Problem:** The non-reasoning path uses `streamText()` + `result.pipeTextStreamToResponse(res)` with no error handler. If the AI provider stream fails mid-way (network error, provider timeout, model error), `refundGlobalRequest()` is never called and `refundDailyLimit` is never called. The `onFinish` callback (line 531) only fires on successful completion — it handles `recordUsage`, not refunds. Compare with the reasoning path (`streamFireworksReasoning`) which has a proper try-catch at line 384-387 with `refundGlobalRequest()`.

**Fix:** Wrap the non-reasoning path in a try-catch, or add an `onError` handler to `streamText` that calls `refundGlobalRequest()` and `refundDailyLimit(uid)`. The `pipeTextStreamToResponse` call should be inside the try block.

**Risk:** Low. The refund is best-effort. The stream may have already partially written to `res`, but the response should still be ended cleanly.

---

### H-3 — `firestore.ts._initPromise` never reset on failure (stale rejected promise kills cloud sync)

**Severity:** High  
**Files:** `src/core/firebase/firestore.ts:28-53`

**Problem:** `getDb()` caches `_initPromise` but never wraps it in try-catch. If `initializeFirestore()` or `import('firebase/firestore')` throws (transient failure, network issue during SDK import), `_initPromise` stays as a rejected promise forever. Every subsequent `getDb()` call returns the same rejected promise — all cloud sync is dead until a full page reload.

The previous audit (26.06, H-1) fixed this in `firestoreClient.ts:22-27` with a try-catch that resets `_initPromise = null`. However, `firestoreClient.ts` calls `getDb()` from `firestore.ts` at line 17. When `firestoreClient.ts` resets its own `_initPromise` and retries, it calls `getDb()` again — which returns the stale rejected promise from `firestore.ts`. The fix in `firestoreClient.ts` is ineffective because the underlying `getDb()` is still broken.

**Fix:** Apply the same try-catch pattern to `getDb()` in `firestore.ts`:
```typescript
try {
  return await _initPromise;
} catch (e) {
  _initPromise = null;
  throw e;
}
```

**Risk:** None. The fix only adds retry capability after failure. Success path is unchanged.

---

### M-1 — `userPortrait` not injection-checked or sanitized

**Severity:** Medium  
**Files:** `functions/src/ai/chatWithAI.ts:100`, `api/chat.ts:491,509`

**Problem:** `userPortrait` is a client-supplied field (`z.string().max(100_000).nullish()`), injected directly into the system prompt via `buildChatSystemPrompt`. It is NOT checked against `INJECTION_PATTERNS` and NOT passed through `sanitizeAiInput`. A user can store arbitrary content in their `aiPortrait` Firestore field (allowed by `isValidUserUpdate`), then send it as `userPortrait` to inject prompt-level instructions that bypass the injection guard. Tokens like `<|im_start|>`, `[INST]`, zero-width chars would pass through.

**Fix:** Add `INJECTION_PATTERNS` check on `userPortrait` before passing to `buildChatSystemPrompt`. Also pass through `sanitizeAiInput(userPortrait)`.

**Risk:** Low. If a legitimate portrait contains text matching an injection pattern, the call will be rejected. This is the correct behavior — the portrait should be user-authored content, not control tokens.

---

### M-2 — `customSystemPrompt` not sanitized with `sanitizeAiInput`

**Severity:** Medium  
**Files:** `functions/src/ai/chatWithAI.ts:99`, `api/chat.ts:491,509`

**Problem:** `customSystemPrompt` is checked against `INJECTION_PATTERNS` (which catches `<|im_start|>`, `[INST]`, `<developer>`, `<end_of_turn>`) but NOT passed through `sanitizeAiInput`. The `sanitizeAiInput` function neutralizes additional markers (` NYT`, ` NYT`, ` NYT`, `<|im_end|>`) and zero-width characters that bypass `INJECTION_PATTERNS`. The custom prompt is injected directly into the system prompt without these additional neutralizations.

**Fix:** Apply `sanitizeAiInput(customSystemPrompt)` before passing to `buildChatSystemPrompt`.

**Risk:** None. `sanitizeAiInput` only strips control tokens, not user content.

---

### M-3 — `ProfileContext` value not wrapped in `useMemo`

**Severity:** Medium  
**File:** `src/features/auth/contexts/ProfileContext.tsx:126`

**Problem:** `value={{ profile }}` is an inline object literal, creating a new reference on every `ProfileProvider` render. Any state change (e.g., `user` from `useAuth` changes) re-renders the provider and causes all `useProfile()` consumers to re-render — even if `profile` hasn't changed. `AuthContext` was fixed in the previous audit (F6), but `ProfileContext` was missed.

**Fix:** `const value = useMemo(() => ({ profile }), [profile]);`

**Risk:** None. Standard React context optimization.

---

### M-4 — `DesktopWritingLayout` inline arrows defeat `WritingHeader`'s `React.memo`

**Severity:** Medium  
**File:** `src/features/writing/pages/DesktopWritingLayout.tsx:106-111`

**Problem:** `WritingHeader` is `React.memo`'d, but `DesktopWritingLayout` passes 6 inline arrow functions: `onNew`, `onOpenLog`, `onSave`, `onPlay`, `onPause`, `onStop`. Each creates a new function reference every render, defeating the memo. The previous audit (F8) fixed `WritingEditor`'s `onKeyDown` with `useCallback`, but `WritingHeader` has the same problem. Combined with timer ticks (500ms), `WritingHeader` re-renders ~2x/second.

**Fix:** Wrap each handler in `useCallback`, or pass the stable `actions.*` handlers directly if they're already memoized.

**Risk:** None. Callbacks become stable across re-renders.

---

### L-1 — 24 `console.error`/`console.warn` in production code (errors invisible to Sentry)

**Severity:** Low  
**Files:** 12 files across features/

**Problem:** The previous audit (F7) fixed 39 `console.error`/`console.warn` calls in 4 files (`useSyncDiagnostics`, `useDiagnosticsData`, `useEmbeddingIndexer`, `useAIChat`). 24 more instances remain across 12 files:

| File | Count | Context |
|------|-------|---------|
| `ArchiveExportService.ts` | 2 | Share failed |
| `ArchiveNoteList.tsx` | 1 | Portrait generation failed |
| `DocumentPreview.tsx` | 1 | Manual portrait failed |
| `ProfileFacets.tsx` | 3 | Load/build/resummarize failed |
| `EmbeddingDiagnostics.tsx` | 5 | Coverage/index/reindex/sync/search failed |
| `DatabaseExplorer.tsx` | 2 | Generic catch |
| `AIEmbeddingService.ts` | 3 | Cloud read/save/sync failed |
| `AIChatMemoryService.ts` | 2 | extractFromDialogue/addManual failed |
| `DiagnosticsPage.tsx` | 1 | Mass analyze failed |
| `useAIPageData.ts` | 1 | draftFacet handling failed |
| `ContactDoors.tsx` | 1 | Analysis failed |
| `noteRetriever.ts` | 2 | Embed failed |

**Fix:** Replace with `reportError(e, { action: '...' })` for error paths. Leave informational `console.warn` (i18n missing key, store dropped keys) as-is.

**Risk:** Low. `reportError` sends to Sentry with PII scrubbing. Slightly increased Sentry event volume.

---

### L-2 — 5 AI infra functions don't check `INJECTION_PATTERNS` on inputs

**Severity:** Low  
**Files:** `summarizeDocument.ts:51`, `summarizeFacet.ts:46`, `rerankNotes.ts:41`, `embedDocument.ts:58`, `extractChatMemory.ts:53`

**Problem:** These functions apply `sanitizeAiInput` (control token neutralization) but do NOT check `INJECTION_PATTERNS` on their inputs. Output is sanitized via `sanitizeAiResponse` or is structured data (vectors/IDs), providing defense-in-depth. Risk is low but inconsistent with `chatWithAI` and `editWithAI` which do check.

**Fix:** Add `INJECTION_PATTERNS` check on inputs for consistency, especially `extractChatMemory` which processes user-authored message content.

**Risk:** None. Injections in these paths produce structured/vectors, not free-text that could leak to users.

---

### L-3 — `isValidUserCreate` doesn't validate `data.uid == request.auth.uid` inside validator

**Severity:** Low (note)  
**File:** `firestore.rules:51-72`

**Problem:** `isValidUserCreate` checks `data.uid is string && data.uid.size() > 0` but not `data.uid == request.auth.uid`. The path-level `isOwner(userId)` match rule (line 155) ensures the document path matches `request.auth.uid`, but the `uid` field in data could differ. Impact is minimal since `uid` is blocked from update (line 162).

**Fix:** Add `data.uid == request.auth.uid` to `isValidUserCreate` for completeness.

**Risk:** None. If client code writes a `uid` field that doesn't match auth UID, the write will now fail.

---

## Comparison with Previous Report (26.06)

| Previous ID | Status | Notes |
|-------------|--------|-------|
| C1 (internal flag bypass) | **Verified fixed** | `callType` server-validated via `aiPolicy.ts` |
| C2 (TOCTOU global limit) | **Verified fixed** | `tryReserveGlobalRequest()` uses transaction |
| C3 (summarizeDocument refund) | **Verified fixed** | No `refundDailyLimit` calls in summarizeDocument |
| H4 (chatWithAI refund on AI fail) | **Verified fixed** | `chatWithAI.ts:124` |
| H2 (editWithAI refund) | **Verified fixed** | `editWithAI.ts:74,108` |
| H3 (validateCustomPrompt refund) | **Verified fixed** | `validateCustomPrompt.ts` |
| H5 (extractChatMemory role enum) | **Verified fixed** | `z.enum(['user', 'assistant'])` |
| H8 (FIREWORKS_API_KEY check) | **Verified fixed** | Explicit check before request |
| H-1 (firestoreClient._initPromise) | **Partial fix** | `firestoreClient.ts` fixed, but `firestore.ts` (root cause) not — see H-3 |
| F1 (useSessionFlow useMemo) | **Verified fixed** | `useSessionFlow.ts:139-146` |
| F2 (useDraftAutosave interval) | **Verified fixed** | 30s interval safety net |
| F6 (AuthContext useMemo) | **Verified fixed** | `AuthContext.tsx:40-46`. ProfileContext still broken — see M-3 |
| F7 (console.error → reportError) | **Partial fix** | 4 files fixed, 12 more have instances — see L-1 |
| F8 (WritingEditor React.memo) | **Verified fixed**. New instance for WritingHeader — see M-4 |

---

## Summary

| Severity | Count | IDs |
|----------|-------|-----|
| Critical | 0 | — |
| High | 3 | H-1, H-2, H-3 |
| Medium | 4 | M-1, M-2, M-3, M-4 |
| Low | 3 | L-1, L-2, L-3 |
| **Total** | **10** | |

| Section | Items | PASS | FAIL |
|---------|-------|------|------|
| 1 — Security | 14 | 12 | 2 |
| 2 — Race Conditions | 8 | 8 | 0 |
| 3 — Error Recovery | 9 | 7 | 2 |
| 4 — Encryption | 11 | 11 | 0 |
| 5 — React Patterns | 11 | 8 | 3 |
| 6 — Data Integrity | 8 | 8 | 0 |
| 7 — PWA + SEO | 10 | 10 | 0 |
| 8 — AI Chat | 9 | 9 | 0 |
| Invariants | 5 | 4 | 1 |
| **Total** | **85** | **77** | **8** |

### Top 3 Priorities

1. **H-1 + H-2** — Add `refundDailyLimit` and error handler to `api/chat.ts` non-reasoning path. Users currently lose daily quota on global-limit rejections and stream failures.
2. **H-3** — Fix `firestore.ts._initPromise` reset. The `firestoreClient.ts` fix from the previous audit is ineffective because the underlying `getDb()` is still broken.
3. **M-1 + M-2** — Sanitize and injection-check `userPortrait` and `customSystemPrompt` before model call. These are the last unsanitized paths to the system prompt.
