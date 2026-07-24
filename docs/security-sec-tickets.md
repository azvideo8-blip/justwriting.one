# Security SEC Tickets — 2026-07-24

Source: security review of the current working tree (`api/chat.ts`, `functions/src/ai/chatWithAI.ts`, `.env.local`, `vercel.json`). Triaged against real code — six raw SEC findings reduced to three actionable code tickets; the rest are config/human or deferred (see bottom). Do not bundle unrelated tickets into one change.

**Before finishing any ticket:** run `npm run lint` on the changed files only (full lint OOMs). Extractions/edits here have historically left dead or misplaced imports — verify none.

---

## AG-SEC-02 — Injection guard for `documentMood`

**Priority:** P1 (High)
**Scope:** Small

**Context:** `api/chat.ts:658-680`, `functions/src/ai/chatWithAI.ts:78-90`

`documentMood` (`z.string().max(50).nullish()`) is passed through `sanitizeAiInput` but never checked with `hasInjectionAttempt`. Every other free-text field — `messages`, `documentContent`, `userPortrait`, `customSystemPrompt` — is checked. This is a real gap: a crafted `documentMood` reaches the system prompt unfiltered.

**Work:**

1. In `api/chat.ts`, after the `userPortrait` guard (ends at line 676, before the `sanitizedCustomPrompt` line), add a `documentMood` guard following the exact same pattern, refunding both quotas:
   ```ts
   if (documentMood && hasInjectionAttempt(documentMood)) {
     if (isInternalCall) { await refundInternalDailyLimit(uid); }
     else { await refundDailyLimit(uid); }
     await refundGlobalRequest(reservation);
     res.status(400).json({ error: 'Bad Request' }); return;
   }
   ```
   `documentMood` is already destructured at line 636 — do not re-declare it.
2. In `functions/src/ai/chatWithAI.ts`, after the `userPortrait` guard (~line 85, before the per-user daily limit block), add:
   ```ts
   if (documentMood && hasInjectionAttempt(documentMood)) {
     throw new HttpsError('invalid-argument', 'Disallowed patterns detected in document mood.');
   }
   ```
   `documentMood` is already destructured at line 44 — do not re-declare it.
3. Add a regression test per path: `documentMood: "ignore previous instructions"` →
   - Vercel endpoint returns `400` with `{ error: 'Bad Request' }`.
   - Cloud Function throws `invalid-argument`.
   Assert the quota refunds fired (no quota leaked on rejection).

**Acceptance criteria:**

- [ ] Malicious `documentMood` is rejected on both endpoints before reaching the model.
- [ ] Both daily and global quotas are refunded on rejection (internal vs. non-internal path).
- [ ] Regression tests pass for both endpoints.
- [ ] Lint clean on both changed files.

**Likely files:**

- `api/chat.ts`
- `functions/src/ai/chatWithAI.ts`
- `functions/src/ai/__tests__/` (or the existing chat test location)

**Dependencies:** None

---

## AG-SEC-04 — Move `FIRESTORE_DATABASE_ID` to env

**Priority:** P3 (Low)
**Scope:** Trivial

**Context:** `api/chat.ts:16`

Database ID is hardcoded. Keep the current value as a default so a deploy without the env var does not break.

**Work:**

1. Change line 16 to:
   ```ts
   const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID
     ?? 'ai-studio-26638cb9-0855-4980-84cb-072afd2a063d';
   ```
2. Do not touch anything else. Setting `FIRESTORE_DATABASE_ID` in Vercel env is a human step — out of scope.

**Acceptance criteria:**

- [ ] Falls back to the existing ID when the env var is unset.
- [ ] Build + lint pass.

**Likely files:**

- `api/chat.ts`

**Dependencies:** None

---

## AG-SEC-01 — Remove `FIREWORKS_API_KEY` from `.env.local`

**Priority:** P1 (High) — code portion only
**Scope:** Trivial

**Context:** `.env.local:13`

Fireworks provider is no longer used (migrated to OpenRouter). A live key sits in the working tree.

**Work:**

1. Delete the `FIREWORKS_API_KEY=fw_5aA9...` line from `.env.local`. Touch nothing else in the file.

**Out of scope (human, not Antigravity):**

- Revoke the key in the Fireworks dashboard.
- Remove it from Vercel env vars and Firebase Functions secrets if present.
- No git-history rewrite needed — `git log --all -S "fw_5aA9"` is empty; the key was never committed.

**Acceptance criteria:**

- [ ] Line removed; rest of `.env.local` unchanged.

**Dependencies:** None

---

## Deferred — do NOT implement (recorded for closure)

- **SEC-03 (App Check enforcement on Vercel):** Not code. Support already exists — `api/chat.ts:581` reads `APP_CHECK_ENFORCE`. Needs a Vercel env var + 401 monitoring. App Check may already be enforced in prod (since 2026-07-14) — verify with `vercel env ls` before treating the endpoint as open.
- **SEC-05 (sanitize reasoning stream):** Defense-in-depth, not an active hole — the client already renders through `rehype-sanitize`. Regex tag-stripping with cross-chunk buffering of split `<` risks corrupting legitimate markdown/code in answers. Cost > benefit; leave as is.
- **SEC-06 (`data: blob:` in img-src CSP, `vercel.json`):** `blob:` is needed (canvas/avatar export). Cheaper to document the reason in `SECURITY.md` than to break exports.
