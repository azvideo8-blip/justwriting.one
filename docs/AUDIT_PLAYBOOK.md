# Audit Playbook

Reproducible audit process for justwriting. Run this checklist on every major change or before release.

## How to Use

1. Run each section in order — earlier sections catch systemic issues that later sections depend on.
2. For each finding, record: ID, Severity (Critical/High/Medium/Low), File:line, Category, Description, Suggested fix.
3. Compare with previous report (`docs/report *.md`) — mark duplicates as "already fixed" or "regression".
4. Output format: markdown table per section, same as `docs/report 26.06.md`.

## Pre-flight

```
npm run ci          # typecheck + lint + test:ci — must be green
git status -sb      # must be clean
git log --oneline -5  # know what changed since last audit
```

## Section 1: Security (Functions + API + Firestore Rules)

**Files:** `functions/src/**`, `api/chat.ts`, `firestore.rules`, `storage.rules`

Check:
- [ ] All callable functions check `request.auth` before any logic
- [ ] Admin functions verify admin role via Firestore (not client claims)
- [ ] No client-supplied flag can bypass rate limits or quotas
- [ ] `callType` internal calls are restricted (low maxTokens, no custom persona, no reasoning)
- [ ] Injection patterns checked on ALL user-supplied content (messages, customSystemPrompt, documentContent)
- [ ] `sanitizeAiInput` applied to all content before model call
- [ ] `sanitizeAiResponse` applied to all model output (or `rehypeSanitize` on client)
- [ ] `img` tags stripped from AI output (custom sanitize schema)
- [ ] Firestore rules: `userId == request.auth.uid` in all create validators
- [ ] Firestore rules: `role`/`uid`/`email` not client-writable
- [ ] Firestore rules: `anonymizedTelemetry` is create-only (no update/delete by non-admin)
- [ ] Firestore rules: no wildcard `allow read/write: if true` anywhere
- [ ] No secrets in code, `.env*` gitignored, Firebase config is public-safe
- [ ] `enforceAppCheck` documented if disabled

## Section 2: Race Conditions + Concurrency

**Files:** `functions/src/shared/aiUtils.ts`, `src/core/services/**`, `src/core/storage/localDb.ts`

Check:
- [ ] `tryReserveGlobalRequest` uses Firestore transaction (atomic check-and-increment)
- [ ] `checkDailyLimit` / `checkRateLimit` use Firestore transactions
- [ ] No TOCTOU in global limit (test: N parallel requests at boundary → no overage)
- [ ] IDB read-modify-write operations use `db.transaction('store', 'readwrite')` (not get-then-put)
- [ ] `LockManager` in `StorageService` serializes per-document saves
- [ ] `AIDialogueService` all mutations use readwrite transactions
- [ ] `encryptMigration` has concurrency guard (`_migrationInProgress` Set)
- [ ] No concurrent `sendMessage` calls (re-entrancy guard)

## Section 3: Error Recovery + Refund

**Files:** `functions/src/ai/**`, `api/chat.ts`, `src/core/services/CloudSyncService.ts`

Check:
- [ ] `refundDailyLimit(uid)` called in catch block of every AI function
- [ ] `refundGlobalRequest()` called in catch block of every AI function
- [ ] `streamFireworksReasoning` has try-catch around reader loop
- [ ] `recordUsage` called before `res.end()` in streaming path
- [ ] `addLocalCopy` handles per-version decryption errors (one corrupted version doesn't block all)
- [ ] Post-save cleanup: `resetSession` after cleanup succeeds (not before)
- [ ] `useDraftAutosave` has 30s interval safety net (debounce may never fire during continuous typing)
- [ ] `firestoreClient._initPromise` resets on failure (cloud sync recovery)
- [ ] `firestore.ts` has `online` event listener for connection recovery

## Section 4: Encryption + Vault

**Files:** `src/core/crypto/**`, `src/core/services/EncryptionService.ts`, `src/features/encryption/**`

Check:
- [ ] `lockVault` does NOT call `setEncryptionEnabled(false)` — only clears session key
- [ ] `maybeEncrypt` throws `ENCRYPT_REQUIRED` when vault locked (never silently saves plaintext)
- [ ] `useEncryptionSetup` subscribes to `isVaultUnlocked` — shows unlock prompt after auto-lock
- [ ] Device key verified against `verification` ciphertext before auto-unlock
- [ ] `keyVaultCache` uses `finally db?.close()` on all paths
- [ ] `UnifiedSessionLoader` sets `cloudContent = ''` (not ciphertext) when vault locked
- [ ] `LegacyKeyMigration` nulls out `encryptionSalt`/`encryptedDataKey` after migration
- [ ] `EncryptionMetaService.saveEncryptionMeta` uses `deleteField()` for legacy cleanup

## Section 5: React Patterns + Performance

**Files:** `src/features/**`, `src/shared/hooks/**`, `src/app/**`

Check:
- [ ] Context values wrapped in `useMemo` (AuthContext, ProfileContext)
- [ ] `useSessionFlow` return wrapped in `useMemo` (cascading re-render fix)
- [ ] `React.memo` not defeated by inline props (useCallback for handlers)
- [ ] Zustand selectors use `useShallow` when selecting multiple fields
- [ ] `console.error`/`console.warn` in production code → `reportError` (Sentry visibility)
- [ ] `useFocusTrap` MutationObserver scoped to `childList` only (not `subtree`)
- [ ] `useModalEscape` uses `stopImmediatePropagation` (not `stopPropagation`)
- [ ] `useCountUp` doesn't reset `startValueRef` to 0 on target change
- [ ] Timer pauses on `useBaseWritingSession` unmount (no drift on route change)
- [ ] `useWpm` doesn't zero WPM on pause (only on idle)
- [ ] Error boundaries: outer over Suspense + per-route + not removable by Escape when dismissable=false

## Section 6: Data Integrity + IDB

**Files:** `src/core/services/LocalDocumentService.ts`, `LocalVersionService.ts`, `LocalStorageService.ts`

Check:
- [ ] `saveVersionToLocal`: quota failure → throw, not silent cloud push
- [ ] `LocalDocumentService` batch ops (tags/labels) in single transaction
- [ ] `collapseToLatest` in single transaction
- [ ] `updateAfterSession` incremental profile update (no full `getAll()` scan)
- [ ] `reconcileSessionsCount` available in Diagnostics for drift repair
- [ ] `localDb` upgrade has `contains` guards on all `createObjectStore`/`createIndex`
- [ ] `localDb` has `oldVersion < 4` placeholder block
- [ ] Guest draft persists all fields (tags, labelId, accumulatedDuration, savedDocumentId, etc.)

## Section 7: PWA + Offline + SEO

**Files:** `public/sw.js`, `public/inline-init.js`, `index.html`, `vercel.json`, `manifest.json`

Check:
- [ ] SW caches asset responses with `cache.put` (not just cache-first read)
- [ ] SW registration has `.catch()` and `controllerchange` listener
- [ ] `Cache-Control: no-cache` for `/sw.js` in `vercel.json`
- [ ] `inline-init.js` default language matches React app (`'ru'`)
- [ ] `og:image` is PNG (not SVG), absolute URL, with dimensions
- [ ] `color-scheme: dark` meta tag
- [ ] `x-default` hreflang points to current page (not site root)
- [ ] Offline banner shows on mobile + zen mode
- [ ] `noscript` message is bilingual
- [ ] `ErrorBoundary` retry uses key remount (prevents crash loop)

## Section 8: AI Chat System

**Files:** `src/features/ai/hooks/useAIChat.ts`, `src/features/ai/services/**`

Check:
- [ ] Stream aborted on dialogue switch + component unmount
- [ ] `sendMessage` has re-entrancy guard (`isLoading` check)
- [ ] `reader.releaseLock()` in finally block of `streamChat`
- [ ] Regenerate: new response included in variants array (not lost on switch)
- [ ] Facet build: save new before deleting old (not `db.clear` first)
- [ ] `AIDialogueService` all mutations use IDB readwrite transactions
- [ ] `MarkdownRenderer` custom sanitize schema strips `img` tags
- [ ] AI daily limit store has midnight UTC reset timer
- [ ] `documentContent` checked against injection patterns (not just user messages)

## Running the Tests

### Frontend tests
```
npm run ci          # typecheck + lint + vitest
```

### Functions tests (with Firestore emulator)
```
cd functions && npm test
# or: firebase emulators:exec --only firestore "cd functions && npx vitest run"
```

### Firestore rules tests
```
cd functions && npx vitest run src/__tests__/rules.test.ts
# requires Firestore emulator running
```

## Report Template

```markdown
# Architecture Audit — {date}

**Project:** justwriting-one v{version}
**Auditor:** {name}
**Status:** {N} findings, {M} fixed

## {Section Name}
| # | Severity | File | Lines | Category | Description | Fix |
|---|----------|------|-------|----------|-------------|-----|

## Summary
| Severity | Count |
|----------|-------|
| Critical | N |
| High | N |
| Medium | N |
| Low | N |
```
