# Architecture Audit — Deep Critical/High Pass

**Date:** 2026-06-27
**Project:** justwriting-one v0.7.35
**Auditor:** AI-assisted (5 parallel agents + manual verification)
**Status:** 21 new findings (5 Critical, 16 High)

## Audit Coverage

**Files read:** ~110 source files (31 read directly in full/partial, ~80 read via parallel exploration agents across `src/`, `functions/src/`, `api/`, `firestore.rules`, `storage.rules`, `vercel.json`, `index.html`, `public/`).

**Deepest areas:**
- Cloud Functions AI endpoints — all 8 functions fully traced (auth → validation → limits → injection → AI call → refund → record)
- Encryption/vault system — crypto helpers, migration, setup hook, encryption store, meta service, session loader
- Firestore rules — every collection path and validation function traced
- Draft persistence flow — WritingDraftService → persistDraft → useDraftAutosave/useDraftManager → useDraftCore
- Injection patterns and sanitization — injectionPatterns.ts, buildChatPrompt.ts, sanitizeAiInput, all call sites

**Prior reports verified:** `docs/report 26.06.md` (46 fixes, v0.7.32) and `docs/report 27.06.md` (10 findings, v0.7.34 → fixed in v0.7.35). No regressions found — all verified fixes remain in place. All findings below are genuinely new.

---

## Section 1: Security (Functions + API + Firestore Rules)

| # | Severity | File | Lines | Category | Description | Fix |
|---|----------|------|-------|----------|-------------|-----|
| S-1 | Critical | 6 AI functions (see below) | — | DoS / quota theft | **Systemic global-quota burn DoS.** 6 of 8 AI Cloud Functions call `tryReserveGlobalRequest()` BEFORE input validation and injection checks, with no refund on rejection. A single authenticated user can exhaust the project-wide daily cap (default 10,000) by sending invalid payloads, denying AI for ALL users. | Move `tryReserveGlobalRequest()` to after all validation/injection checks, matching `chatWithAI.ts` ordering. Or add `refundGlobalRequest()` to every early-exit throw path. |
| S-2 | Critical | `src/shared/ai/injectionPatterns.ts` | 5-21 | False positive / feature break | **Injection patterns false-positive on user's own notes.** `/забудь/i` matches "не забудь" (don't forget — ubiquitous in Russian prose). `/system\s*:/i` matches "operating system:". `/as\s+an\s+AI/i` matches "as an airline" (no word boundary). These are applied to `documentContent` (user's notes as RAG context) and `userPortrait` (AI-generated summary). In a Russian-language journaling app, this blocks the core AI chat feature for legitimate content. If the portrait inherits "забудь", ALL chat is permanently blocked. | Remove injection checks from `documentContent`/`userPortrait` (user content, not instructions). Or use a narrower pattern set for context fields. Add `\b` word boundaries to remaining patterns. |
| S-3 | High | `functions/src/ai/chatWithAI.ts`, `api/chat.ts` | 72-73, 505-506 | Injection bypass | **Injection bypass via fabricated assistant role messages.** Only `role: 'user'` messages are checked against `INJECTION_PATTERNS`. Client-controlled `role: 'assistant'` messages pass through with only `sanitizeAiInput` (strips control tokens, not natural-language injection like "ignore previous instructions"). User can fabricate an assistant message that redefines the model's role. | Apply `INJECTION_PATTERNS` check to ALL messages regardless of role, or at minimum to assistant messages. |
| S-4 | High | `functions/src/ai/chatWithAI.ts`, `api/chat.ts`, `src/shared/ai/buildChatPrompt.ts` | 78-85, 511-521, 57-58 | Injection bypass | **`documentMood` not injection-checked.** Sanitized via `sanitizeAiInput` (control tokens stripped) but never checked against `INJECTION_PATTERNS`. Interpolated directly into system prompt at `buildChatPrompt.ts:58`: `[Настроение: ${safeMood}]`. 50-char limit fits "ignore previous instructions" (29 chars). | Add `INJECTION_PATTERNS` check on `documentMood` in both `chatWithAI.ts` and `api/chat.ts`, with refund on rejection. |
| S-5 | High | `functions/src/ai/summarizeFacet.ts` | 53-56 | Injection bypass | **`focus` field not injection-checked.** Sanitized but not checked against `INJECTION_PATTERNS`. Interpolated into system prompt: `Опиши ТОЛЬКО то, что относится к теме «${focus}»`. 200-char limit allows meaningful injection content. | Add `INJECTION_PATTERNS` check on `focus` before building system string. |
| S-6 | High | `functions/src/ai/summarizeDocument.ts` | 52-61 | Injection bypass | **`mood` field not injection-checked.** Only `content` is checked (line 52). `mood` is sanitized but not injection-checked, then prepended to the user prompt: `[Настроение документа: ${safeMood}]`. 50-char limit fits "system: ignore previous" (24 chars). | Add `INJECTION_PATTERNS` check on `mood` after line 54. |
| S-7 | High | `functions/src/ai/rerankNotes.ts` | 13, 50 | Injection bypass | **`documentId` not sanitized or injection-checked.** Interpolated raw into the AI prompt: `docId=${c.documentId}`. The `card` content is sanitized and injection-checked (line 44), but `documentId` is not. Newlines in `documentId` allow breaking out of the docId context. 200-char limit. | Validate `documentId` with a strict regex (`/^[a-zA-Z0-9_-]{1,200}$/`), or sanitize and injection-check it. |
| S-8 | High | `api/chat.ts` | 307-310 | Quota leak | **Reasoning mode upstream 502 — no quota refund.** `streamFireworksReasoning` returns 502 on upstream non-OK response without calling `refundGlobalRequest()` or `refundDailyLimit(uid)`. Daily limit and global slot were already reserved (lines 484, 489). Fireworks 502/503 is a documented common occurrence — each failure permanently burns user quota. | Add `await refundGlobalRequest(); if (!isInternalCall) await refundDailyLimit(uid);` before `res.status(502).end()`. Also add refund before the API-key-missing return at line 289. |
| S-9 | High | `api/chat.ts`, `functions/src/shared/aiUtils.ts` | 146-154, 176-185 | Quota integrity | **`refundGlobalRequest` has no clamping or date guard.** Both implementations do `FieldValue.increment(-1)` with no transaction, no date check, no floor. Compare with `refundDailyLimit` which uses a transaction with date verification and `Math.max(0, ...)`. Cross-day refunds (request at 23:59, refund at 00:01) decrement the wrong day. No floor means the counter can go negative, granting free capacity beyond the cap. | Mirror `refundDailyLimit` pattern: use a transaction, verify `data.date === date`, clamp with `Math.max(0, ...)`. |
| S-10 | High | `firestore.rules` | 252-256 | Storage abuse / cost DoS | **`anonymizedTelemetry` create has no field validation.** `allow create: if isAuthenticated()` — no `isValidTelemetry()` function, no `hasOnly`, no field type checks, no size limits. Every other writeable collection has validation. An authenticated user can bypass the client-side 14-day rate limiter by calling Firestore SDK directly, creating unbounded data. | Add a validation function with `hasOnly`, field type checks, and size limits, matching the pattern of `isValidDraft`. |
| S-11 | High | `firestore.rules` | 223-229 | Storage abuse | **`summaries` and `embeddings` allow unrestricted write.** `allow read, write: if isOwner(userId)` with no validation function, no `hasOnly`, no size limits. Users can write arbitrary data (including crafted embedding vectors that manipulate their own AI search results). | Add validation functions with field whitelists and size limits. |
| S-12 | High | `firestore.rules` | 188-192 | Data integrity | **`isValidDocumentUpdate` missing `hasOnly`.** Unlike `isValidVersion` and `isValidDraft` (which both enforce `hasOnly`), document updates allow arbitrary extra fields of any type/size. A user can change the `userId` field inside the document to another user's UID — the path-based `isOwner(userId)` check uses the path variable, not the document field, so this doesn't grant cross-user access directly, but any server-side code that reads the document's `userId` field for joins or ownership could misattribute data. | Add `data.keys().hasOnly(['title', 'tags', 'labelId'])` to `isValidDocumentUpdate`. |

### S-1 Detail — Systemic global-quota burn DoS

**Affected functions (all call `tryReserveGlobalRequest()` before validation, no refund on rejection):**

| Function | File | Global reserve line | First validation line | Daily limit also leaked? |
|----------|------|---------------------|-----------------------|--------------------------|
| `editWithAI` | `functions/src/ai/editWithAI.ts` | 65 | 78 (parse), 85 (injection) | Yes (line 69, not refunded on parse/injection fail) |
| `summarizeDocument` | `functions/src/ai/summarizeDocument.ts` | 38 | 45 (parse), 52 (injection) | No (no daily limit) |
| `summarizeFacet` | `functions/src/ai/summarizeFacet.ts` | 35 | 39 (parse), 49 (injection) | No |
| `rerankNotes` | `functions/src/ai/rerankNotes.ts` | 31 | 35 (parse), 41 (injection) | No |
| `extractChatMemory` | `functions/src/ai/extractChatMemory.ts` | 42 | 46 (parse), 57 (injection) | No |
| `embedDocument` | `functions/src/ai/embedDocument.ts` | 48 | 52 (parse), 59 (injection) | No |

**Correct order** (as in `chatWithAI.ts`): auth → parse → injection → daily limit → rate limit → global reserve → AI call.

**Exploit:** Any authenticated user sends 10,000 requests with an invalid payload (e.g., `content: ""` failing `.min(1)`, or content containing "забудь" triggering S-2). Each increments `aiGlobalDaily/{date}.requests` by 1 and never decrements it. After 10,000 requests, `tryReserveGlobalRequest()` returns false for EVERY user globally. AI is down for the entire app for the rest of the day.

---

## Section 2: Race Conditions + Concurrency

| # | Severity | File | Lines | Category | Description | Fix |
|---|----------|------|-------|----------|-------------|-----|
| R-1 | High | `src/features/ai/hooks/useAIChat.ts` | 422, 436-437 | Race condition | **`sendMessage` re-entrancy guard uses React state, not ref.** `if (isLoading) return null` checks a state variable that hasn't been committed yet when two calls happen in the same tick. Both bypass the guard, create separate `AbortController`s (second overwrites `abortRef.current`), and send concurrent API requests. The first stream's controller is orphaned — `stop()` only aborts the second. Both calls attempt `AIDialogueService.appendMessage` concurrently, causing lost messages. | Use a ref-based guard (`sendingRef = useRef(false)`) in addition to `isLoading` state, checked synchronously at the top of `sendMessage`. Abort the previous controller before overwriting `abortRef`. |

**Section 2: no new Critical findings.** All previously-fixed concurrency issues (TOCTOU, IDB transactions, LockManager, encryptMigration guard) verified still in place.

---

## Section 3: Error Recovery + Refund

| # | Severity | File | Lines | Category | Description | Fix |
|---|----------|------|-------|----------|-------------|-----|
| E-1 | High | `src/features/ai/hooks/useAIChat.ts` | 110, 424-429 | State corruption | **Client-side daily limit state corrupted when GLOBAL_LIMIT is received.** `streamChat` checks only `response.status === 429` and throws `DAILY_LIMIT` without parsing the response body. The server returns `429` with `{ error: 'GLOBAL_LIMIT' }` (line 491) but also refunds the daily limit (line 490). The client calls `setDailyLimitExhausted()` which sets `remaining = 0`, permanently blocking all future sends until page refresh — even though the server refunded the daily quota. The user sees "Дневной лимит достигнут" (Daily limit reached) when the actual issue is the project-wide cap. | Parse the 429 response body to distinguish `GLOBAL_LIMIT` from `DAILY_LIMIT`. Don't call `setDailyLimitExhausted()` on global limit. |

**Section 3: no new Critical findings.** All previously-fixed error recovery issues (refund on AI failure, recordUsage before res.end, firestoreClient/firestore init reset, online listener) verified still in place. The reasoning-mode upstream 502 no-refund issue is reported as S-8 in Section 1.

---

## Section 4: Encryption + Vault

| # | Severity | File | Lines | Category | Description | Fix |
|---|----------|------|-------|----------|-------------|-----|
| V-1 | Critical | `src/features/auth/pages/LoginPage.tsx`, `src/features/auth/contexts/ProfileContext.tsx` | 105, 108; 59, 65, 69 | Plaintext leak / data corruption | **Encryption silently disabled on vault-unlock failure → plaintext overwrites encrypted cloud data.** When `unlockVaultFromProfile` returns false (password reset, wrong password) or profile parsing fails, `setEncryptionEnabled(userId, false)` is called. `maybeEncrypt` then returns plaintext for all cloud writes. For drafts: `setDoc(..., {merge:true})` writes plaintext `content` but doesn't remove the existing `_encrypted:true` field → `maybeDecrypt` tries to decrypt plaintext → throws `DecryptionError` → **draft becomes permanently unreadable even with the correct key**. For versions: new versions are plaintext while old versions stay encrypted → cloud holds a mix; new content is exposed. | Never silently flip `encryptionEnabled` to false when `encryptionMeta` exists. Block cloud writes (or force-lock the vault) until the user explicitly chooses "start fresh". Never merge plaintext into a doc previously marked `_encrypted`. |
| V-2 | Critical | `src/core/crypto/encryptMigration.ts` | 138, 187, 235 | Silent encryption failure | **Encryption migration silently no-ops when vault locks mid-run.** `maybeEncrypt` is called without the `required` flag (4th arg). If `getSessionKey()` returns null (vault auto-locked mid-migration), `maybeEncrypt` returns the plaintext doc without error. The doc is written back as plaintext, `progress.encrypted++` increments, and the checkpoint marks it as done. The user believes E2E migration is complete; their notes remain plaintext in cloud forever. The checkpoint prevents re-encryption on the next run. | Pass `true` (required) as the 4th arg to `maybeEncrypt` in all three migration call sites. A missing key will throw `ENCRYPT_REQUIRED`, caught per-doc (increments `errors`, does NOT checkpoint). Re-check `getSessionKey()` each iteration. |
| V-3 | High | `src/core/crypto/useEncryptionStore.ts` | 24, 38-44 | Security bypass | **`rememberDevice` flag is global and leaks across users.** Module-level `let rememberDevice = false` is never reset on sign-out, user switch, or `lockVault()`. User A opts into "Remember on this device" → signs out → User B signs in on the same browser → `rememberDevice` is still `true` → B's vault never auto-locks despite B never opting in. The flag is only reset on explicit lock via `AccountVaultSection.handleLockVault`. | Scope `rememberDevice` per-user (store alongside `encryptionEnabled`), or reset it to `false` in `lockVault()` / on auth user change. |
| V-4 | High | `src/features/encryption/hooks/useEncryptionSetup.ts`, `src/core/services/EncryptionMetaService.ts` | 49; 43 | Data loss | **Device-key auto-unlock skips verification when `verification` is empty.** `if (meta?.verification)` — empty string `''` is falsy, so the verification block is skipped. `getEncryptionMeta` returns `verification: ''` when the field is missing (line 43). A stale/wrong cached device key is silently accepted via `setSessionKey(deviceKey)` without verification. All new writes are encrypted with the wrong key → permanent data loss when the user unlocks on another device with the correct password. | Require a non-empty `verification` string for device-key auto-unlock. If missing, refuse auto-unlock and force a password prompt. |

**Section 4: no regressions.** All previously-fixed encryption issues (lockVault not disabling encryption, maybeEncrypt throwing ENCRYPT_REQUIRED, keyVaultCache finally close, UnifiedSessionLoader cloudContent='') verified still in place.

---

## Section 5: React Patterns + Performance

**Section 5: no new Critical/High findings.** All previously-fixed React issues verified still in place:
- `useSessionFlow` return wrapped in `useMemo` ✓
- `AuthContext` value wrapped in `useMemo` ✓
- `ProfileContext` value wrapped in `useMemo` (fixed in v0.7.35) ✓
- `DesktopWritingLayout` inline arrows → `useCallback` (fixed in v0.7.35) ✓
- `useDraftAutosave` 30s interval safety net ✓
- `useFocusTrap` MutationObserver scoped to `childList` ✓
- `useModalEscape` uses `stopImmediatePropagation` ✓
- Error boundaries: outer over Suspense + per-route + key remount ✓

---

## Section 6: Data Integrity + IDB

| # | Severity | File | Lines | Category | Description | Fix |
|---|----------|------|-------|----------|-------------|-----|
| D-1 | Critical | `src/features/writing/services/WritingDraftService.ts` | 114-121 | Silent data loss | **`saveToLocal` swallows IDB errors → UI shows "Saved" but draft is lost.** The catch block reports to Sentry but does NOT re-throw. `persistDraft` uses `Promise.allSettled` which sees `localResult.status === 'fulfilled'` (false positive). `localOk` is always `true`. `useDraftAutosave.doAutosave` checks `if (!result.localOk && !result.remoteOk)` — this is false because `localOk` is a false positive. No error thrown. `wrapSave` calls `markSaved()`. **UI shows "Saved" but the draft is completely lost.** Critical when offline (both saves fail, but `localOk` is true). | Re-throw the error in `saveToLocal`'s catch block after reporting, so `Promise.allSettled` sees `localResult.status === 'rejected'` and `localOk` is `false`. |
| D-2 | High | `src/features/writing/hooks/useDraftManager.ts` | 26-69 | Data loss | **Guest sessions have no `beforeunload` save.** `useDraftManager` calls `useVisibilitySave` but NOT `useSyncUnloadSave`. The `useSyncUnloadSave` hook (which writes to `localStorage` on `beforeunload`/`pagehide`) is only called from `useDraftAutosave` (cloud sessions). A guest user typing continuously for 25 seconds who closes the tab loses everything since the last 30s interval — there is no `beforeunload` fallback. | Call `useSyncUnloadSave` from `useDraftManager`, or extract the `beforeunload` logic into a shared hook used by both paths. |
| D-3 | High | `src/features/auth/components/MigrationPrompt.tsx` | 11-40 | Data loss | **Guest → user draft migration is missing.** `migrateDocuments` only re-keys `documents` and `versions` IDB stores from `guestId` to `userId`. It does NOT touch the `drafts` store. No code anywhere migrates `drafts/{guestId}` to `drafts/{userId}`. A guest user's unsaved draft is permanently lost when they create an account — the new cloud session looks up `drafts/{userId}` (not found) and the guest draft under `drafts/{guestId}` is orphaned. | Add draft migration to `migrateDocuments`: copy `drafts/{guestId}` to `drafts/{userId}` in the same transaction. |

**Section 6: no regressions.** All previously-fixed IDB issues (transaction usage, batch ops, collapseToLatest, localDb upgrade guards, incremental profile update) verified still in place. The `saveNew` non-atomicity (known M-1 deferred) remains deferred — not re-reported.

---

## Section 7: PWA + Offline + SEO

**Section 7: no new Critical/High findings.** All previously-fixed PWA/SEO issues verified still in place:
- SW caches with `cache.put` ✓
- SW registration `.catch()` + `controllerchange` ✓
- `Cache-Control: no-cache` for `/sw.js` ✓
- `inline-init.js` default `'ru'` ✓
- `og:image` PNG, absolute, with dimensions ✓
- `color-scheme: dark` meta ✓
- `x-default` hreflang ✓
- Offline banner on mobile + zen mode ✓
- `noscript` bilingual ✓
- `ErrorBoundary` retry uses key remount ✓

---

## Section 8: AI Chat System

Findings for the AI chat system are reported in Sections 1-3 above (S-1 through S-9, R-1, E-1). Specifically:
- **S-1**: Global quota burn DoS (6 AI functions)
- **S-2**: Injection false-positive on user notes
- **S-3**: Injection bypass via assistant role messages
- **S-4 through S-7**: Injection bypass via unchecked fields (documentMood, focus, mood, documentId)
- **S-8**: Reasoning mode upstream 502 no refund
- **S-9**: refundGlobalRequest no clamping/date guard
- **R-1**: sendMessage re-entrancy guard uses state
- **E-1**: Client-side daily limit corrupted on GLOBAL_LIMIT

**Section 8 checklist verification (all PASS, no regressions):**
- Stream aborted on dialogue switch + unmount ✓ (`useAIChat.ts:334,339`)
- `sendMessage` re-entrancy guard ✓ (present but uses state — see R-1)
- `reader.releaseLock()` in finally ✓ (`useAIChat.ts:178-180`)
- Regenerate: new response in variants ✓
- Facet build: save new before deleting old ✓
- `AIDialogueService` readwrite transactions ✓
- `MarkdownRenderer` strips `img` ✓
- AI daily limit midnight UTC reset ✓
- `documentContent` injection-checked ✓ (but see S-2 for false-positive issue)

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High | 16 |
| **Total** | **21** |

| Section | Critical | High | Total |
|---------|----------|------|-------|
| 1 — Security | 2 | 10 | 12 |
| 2 — Race Conditions | 0 | 1 | 1 |
| 3 — Error Recovery | 0 | 1 | 1 |
| 4 — Encryption + Vault | 2 | 2 | 4 |
| 5 — React Patterns | 0 | 0 | 0 |
| 6 — Data Integrity | 1 | 2 | 3 |
| 7 — PWA + SEO | 0 | 0 | 0 |
| 8 — AI Chat (covered in 1-3) | 0 | 0 | 0 |

### Top 5 to Fix First

1. **S-1 — Systemic global-quota burn DoS** (Critical). A single authenticated user can take down AI for the entire app by sending 10,000 invalid requests to any of 6 Cloud Functions. The fix is a one-line reorder in each function (move `tryReserveGlobalRequest()` after validation).

2. **V-1 — Encryption silently disabled on vault-unlock failure** (Critical). A user who resets their password gets encryption silently disabled. New writes are plaintext, and drafts become permanently corrupt (`_encrypted:true` + plaintext content). This is the most severe data corruption path in the app.

3. **V-2 — Encryption migration silently no-ops when vault locks** (Critical). If the 15-minute auto-lock fires during "Encrypt all existing notes", documents remain plaintext but are checkpointed as done. The user believes E2E encryption is active; their notes are unencrypted in cloud forever.

4. **D-1 — `saveToLocal` swallows errors → silent draft loss** (Critical). When IDB fails (quota, closed connection, private browsing), the error is swallowed. `localOk` is a false positive. The UI shows "Saved" but the draft is completely lost. Combined with offline mode, this is undetectable data loss.

5. **S-2 — Injection patterns false-positive on user's own notes** (Critical). `/забудь/i` matches "не забудь" (don't forget) — one of the most common phrases in Russian personal writing. Applied to `documentContent` (user's notes as RAG context), this blocks the core AI chat feature for legitimate content. In a Russian-language journaling app, this is a core-feature-breaking false positive.
