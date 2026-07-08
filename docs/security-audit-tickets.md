# Security Audit Tickets — July 2026

Self-contained. Prefix: `SEC-`. Source: critical-error audit of the full codebase (2026-07-08). Severity labels follow the audit: 🔴 Critical / 🟠 High / 🟡 Medium / 🔵 Low.

---

## SEC-1 — documentContent and userPortrait not checked for injection patterns 🔴

**Context:** `api/chat.ts:492–508`, `functions/src/ai/chatWithAI.ts:63–76`

`hasInjectionAttempt()` is called on `customSystemPrompt` and each `messages` turn, but NOT on `documentContent` or `userPortrait`. Both fields are only passed through `sanitizeAiInput()`, which strips template tokens (`<|system|>`, `[INST]`, etc.) but does NOT catch phrases like *"ignore previous instructions"*, *"jailbreak"*, or the Cyrillic patterns. Both fields are inserted verbatim into the system prompt (via `buildChatSystemPrompt`), so a user can embed injection phrases in their own notes or portrait and manipulate their own AI session — bypassing the explicit injection guard that was purpose-built to prevent this.

This is self-injection only (can't affect other users), but it breaks the security invariant and the defense-in-depth design.

**Tasks:**
1. In `api/chat.ts`, after the messages injection check (currently line ~501), add:
   ```ts
   if (documentContent && hasInjectionAttempt(documentContent)) {
     if (!isInternalCall) await refundDailyLimit(uid);
     await refundGlobalRequest();
     res.status(400).json({ error: 'Bad Request' }); return;
   }
   if (userPortrait && hasInjectionAttempt(userPortrait)) {
     if (!isInternalCall) await refundDailyLimit(uid);
     await refundGlobalRequest();
     res.status(400).json({ error: 'Bad Request' }); return;
   }
   ```
2. Apply the same fix in `functions/src/ai/chatWithAI.ts` — after the messages injection check (line ~74), add equivalent checks using the local `hasInjectionAttempt` from `aiUtils.ts`.
3. Verify both endpoints are tested in `functions/src/ai/__tests__/chatWithAI.test.ts` — add test cases where documentContent or userPortrait contain "ignore previous instructions".

**Acceptance:** A request where `documentContent` contains "ignore previous instructions" (or any pattern matched by `LATIN_PATTERNS` / `CYRILLIC_PATTERNS`) returns 400. Requests with normal note content are unaffected.

---

## SEC-2 — Duplicate injection pattern list risks coverage divergence 🟠

**Context:** `src/shared/ai/injectionPatterns.ts`, `functions/src/shared/aiUtils.ts:14–41`

Two copies of the same injection pattern list are maintained manually. The comment in `aiUtils.ts` acknowledges this: *"Mirror of src/shared/ai/injectionPatterns.ts — keep in sync."* Currently they are identical, but any future update to one side (e.g. adding a new pattern) without the other silently creates a gap between the Vercel `/api/chat` endpoint and the Firebase Functions `chatWithAI` callable.

**Tasks:**
1. Add a parity test in `functions/src/shared/__tests__/schemaParity.test.ts` (file already exists) that imports `INJECTION_PATTERNS` from both paths and asserts they are deeply equal. This won't eliminate the duplication but will make drift a CI failure instead of a silent gap.
2. (Optional, lower priority) If/when migrating to a shared package (Supabase migration noted in the comment), consolidate into a single source. Do not restructure the monorepo for this alone.

**Acceptance:** `pnpm test` in `/functions` fails if the two pattern lists diverge.

---

## SEC-3 — OPENROUTER_API_KEY configuration detail leaked in error response 🟠

**Context:** `api/chat.ts:280`

```ts
res.status(500).end('OPENROUTER_API_KEY not set');
```

The response body tells any caller exactly which environment variable is missing. This is information disclosure — a misconfigured deployment reveals server internals to the client.

**Tasks:**
1. Replace with a generic message:
   ```ts
   res.status(500).end('Internal server error');
   ```
2. Keep the specific message in `console.error` so it's visible in Vercel logs.

**Acceptance:** A request to `/api/chat` when `OPENROUTER_API_KEY` is unset returns HTTP 500 with body `Internal server error`, not any reference to the env var name.

---

## SEC-4 — Rate limit and daily limit checked in separate transactions in Firebase Functions 🟡

**Context:** `functions/src/ai/chatWithAI.ts:80–87`

`checkDailyLimit` and `checkRateLimit` are two separate Firestore transactions. There is a window between them: if two concurrent requests both pass `checkDailyLimit` (both increment the count) before either writes the cooldown timestamp, both will then pass `checkRateLimit` too. The refund logic handles the failure case but the cooldown is best-effort, not strict.

By contrast, `api/chat.ts:checkAndIncrementLimit` handles both checks in a single transaction, which is correct.

**Tasks:**
1. Merge `checkDailyLimit` and `checkRateLimit` into a single Firestore transaction in `functions/src/shared/aiUtils.ts` — analogous to the `checkAndIncrementLimit` implementation in `api/chat.ts`. The combined function should check and set both the cooldown doc (`aiCooldown/{uid}`) and the daily count (`aiDailyLimit/{uid}`) in one `runTransaction` call.
2. Update `chatWithAI.ts` to call the merged function and remove the now-redundant separate calls.
3. Ensure `refundDailyLimit` still only refunds the daily count (not the cooldown — the cooldown write is idempotent and does not need refunding).

**Acceptance:** Under concurrent load, no two requests from the same user within the 10 s cooldown window both reach the AI provider — verified by an integration test in `functions/src/__tests__/emulator/`.

---

## SEC-5 — changePasswordWithReEncrypt misleadingly re-syncs docs without changing the data key 🟡

**Context:** `src/core/services/EncryptionService.ts:125–176`

`changePasswordWithReEncrypt` re-wraps the same data key under a new master key (correct), then iterates over all local documents and calls `StorageService.addCloudCopy` for each. The comment implies this re-encrypts the documents, but the data key is unchanged — the documents' ciphertext is identical before and after. The re-sync is a no-op from an encryption standpoint and misleads anyone reading the code about what "re-encrypt" means here.

Separately, `changePassword` (the non-re-encrypt version at line 91) does the same key re-wrapping without the loop, which is the correct and complete implementation.

**Tasks:**
1. Remove the `onProgress` branch (lines 162–174) from `changePasswordWithReEncrypt` entirely — it does not re-encrypt anything and adds 0 security value.
2. Rename `changePasswordWithReEncrypt` to `changePassword` (or add a deprecation note pointing to `changePassword`) since they are now equivalent. Check all call sites first — grep for `changePasswordWithReEncrypt` before removing.
3. If the original intent was to re-generate a new data key and re-encrypt all documents with it (i.e. rotate the data key, not just the wrapping), open a separate ticket: this is a significant and risky operation that needs explicit spec work.

**Acceptance:** `changePasswordWithReEncrypt` and `changePassword` produce the same Firestore state. No unnecessary cloud writes on password change. Existing unit tests pass.

---

## SEC-6 — Legacy "sessions" collection documented in Firestore rules but has no access rules 🔵

**Context:** `firestore.rules:11–27`

The schema comment block at the top of `firestore.rules` describes a top-level `sessions` collection, but no `match /sessions/{sessionId}` rule exists. The actual data model uses `users/{userId}/documents/{documentId}/versions/{versionId}`. Because Firestore denies unmatched paths by default, this is safe — clients cannot read or write the `sessions` collection. However, the stale comment suggests a collection that no longer exists in the access model, which can mislead future contributors into thinking there is an unguarded collection.

**Tasks:**
1. Remove the `// Collection: sessions` block from the schema comment in `firestore.rules` (lines 11–28).
2. Confirm via `grep -r '"sessions"' src/ functions/` that no client code writes to a top-level `sessions` collection. If found, add a `allow read, write: if false;` rule explicitly.

**Acceptance:** `firestore.rules` schema comment accurately reflects the real data model with no mention of a `sessions` collection unless it's actually used.

---

## SEC-7 — Dead code: reasoning branch in maxOutputTokens unreachable 🔵

**Context:** `api/chat.ts:541`

```ts
const maxOutputTokens = isInternalCall ? 256 : (reasoning ? 16384 : 8192);
```

Reasoning calls return early at line 537 (`await streamOpenRouterReasoning(...); return;`). The `reasoning ? 16384` branch is dead code — when execution reaches line 541, `reasoning` is always falsy.

**Tasks:**
1. Simplify to:
   ```ts
   const maxOutputTokens = isInternalCall ? 256 : 8192;
   ```

**Acceptance:** Behaviour is unchanged. No test regressions.

---

---

## Post-implementation audit — regressions found (2026-07-08)

The following issues were introduced by the SEC-1..7 fixes above.

---

## SEC-8 — SEC-4 UX regression: cooldown rejection shows "daily limit exhausted" to the user 🟠

**Context:** `functions/src/ai/chatWithAI.ts:89`, `src/features/ai/services/AIService.ts:25–28`

After merging the daily and cooldown checks into a single `checkAndIncrementLimit` call, both rejection reasons return the same `HttpsError` message:

```ts
// chatWithAI.ts:89
throw new HttpsError('resource-exhausted', 'Daily limit reached or cooldown active.');
```

The client's `mapAIError` (AIService.ts:27) dispatches on the message string:

```ts
if (message.toLowerCase().includes('daily limit')) return 'DAILY_LIMIT';
return 'RATE_LIMIT';
```

`'Daily limit reached or cooldown active.'` contains `'daily limit'`, so `mapAIError` always returns `'DAILY_LIMIT'` — even when the actual reason was the 10-second cooldown. A user who sends two messages within 10 seconds sees "Daily limit reached" instead of "Please wait a few seconds." They believe their day's quota is gone when they just need to wait.

**Before (two separate calls):**
- `checkDailyLimit` fails → `'Daily limit reached.'` → `DAILY_LIMIT` ✓
- `checkRateLimit` fails → `'Too many requests. Please wait a few seconds.'` → `RATE_LIMIT` ✓

**After (merged call):** both → `'Daily limit reached or cooldown active.'` → `DAILY_LIMIT` ✗

**Tasks:**
1. Change `checkAndIncrementLimit` in `functions/src/shared/aiUtils.ts` to return a discriminated value instead of a plain boolean:
   ```ts
   export type LimitCheckResult = true | 'DAILY_LIMIT' | 'RATE_LIMIT';
   export async function checkAndIncrementLimit(uid: string, reasoning?: boolean): Promise<LimitCheckResult> {
     ...
     // in transaction:
     if (cooldownData && now - cooldownData.lastRequestAt < COOLDOWN_MS) return 'RATE_LIMIT';
     if (dailyData && dailyData.date === date && dailyData.count >= limit) return 'DAILY_LIMIT';
     ...
     return true;
   }
   ```
2. Update `chatWithAI.ts` to throw the right message per reason:
   ```ts
   const limitResult = !isInternalCall ? await checkAndIncrementLimit(uid, reasoning === true) : true;
   if (limitResult === 'DAILY_LIMIT') throw new HttpsError('resource-exhausted', 'Daily limit reached.');
   if (limitResult === 'RATE_LIMIT') throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few seconds.');
   ```
3. Update `aiUtils.emulator.test.ts` to assert that the return value is `'RATE_LIMIT'` for cooldown rejections and `'DAILY_LIMIT'` for count-exceeded rejections (not just `false`).

**Acceptance:** A user hitting the 10-second cooldown sees the "wait a few seconds" message, not "daily limit reached." Verified by checking that `mapAIError` returns `'RATE_LIMIT'` for cooldown errors and `'DAILY_LIMIT'` for quota errors.

---

## SEC-9 — SEC-2 artifact: schemaParity test validates a stale local schema with wrong field 🟠

**Context:** `functions/src/shared/__tests__/schemaParity.test.ts:4–20`

The schema parity test defines a local `callableSchema` (lines 4–20) with `internal: z.boolean().nullish()` — the **old** field from before `callType` was introduced. The real schemas in both `api/chat.ts` and `chatWithAI.ts` use `callType: z.enum(['auto_name', 'follow_up', 'query_expand']).nullish()`. The local copy never had `callType` added, so the schema parity test passes today despite the local schema being structurally wrong.

The injection patterns parity test in the same file (lines 67–76) is correct — it imports the real modules.

**Tasks:**
1. Delete the local `callableSchema` (lines 4–20) and the `describe('Schema parity between api/chat.ts and chatWithAI.ts', ...)` block entirely. It was never testing real schemas — only a local copy — so it provides false confidence.
2. Replace with a comment explaining why true schema parity can't be a unit test (one schema lives in an ESM Vercel module, the other in Firebase Functions TS — they can't be co-imported in a single test runner without a build step). Document the shared fields in a comment or in `aiPolicy.ts` instead.
3. Keep the injection patterns parity test (lines 67–76) — it works correctly.

**Acceptance:** `schemaParity.test.ts` no longer contains a test that references the stale `internal` field. The injection patterns parity test still passes.

---

## Not doing (explicitly excluded)

- **Rewriting the injection guard as an allowlist** — the current denylist approach is intentional and audited. The system prompt is the primary defense; the injection guard is defense-in-depth for known patterns only.
- **Moving injection checks to the Zod schema layer** — injection patterns can span multiple fields combined into the system prompt. Field-level Zod refinements would be fragile and miss cross-field cases.
- **Enforcing App Check (`enforceAppCheck: true`)** — noted in several Cloud Function definitions as `false`. This is a separate cost/ops decision, not part of this audit.
