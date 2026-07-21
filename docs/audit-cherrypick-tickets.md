# Security/quality audit — cherry-pick tickets (July 2026)

Self-contained. Prefix: `AUD-`. Source: the 21.07.2026 code audit (v0.7.55). This is a **deliberate cherry-pick of 6 items** — cheap, real, and NOT tied to Firebase/Vercel infra that the planned VPS+Supabase migration will replace. **All other audit findings are intentionally deferred** (see the closing note). Owner reviews after implementation.

**Deferred on purpose (do NOT do here):** anything Firestore/Firebase-infra-bound (PERF-2 pagination, DEP-5 double-DB, DEP-2 Node-pin, PERF-9 indexes) — moot after migration; large refactors (ARCH-1/2 AI-module decomposition); pre-scale perf (PERF-1 lazy jszip, virtualization) — invisible at current ~1-user scale; and the CI-automation "Criticals" beyond AUD-2 (CodeQL/Dependabot) — hygiene, not exploitable.

## Guardrails (repo-specific)

- **Run lint.** Full `npm run lint` OOMs — use `npm run lint:changed` (per file). `functions/` is currently outside ESLint (DEP-3) — for functions changes, run `cd functions && npx tsc --noEmit`.
- **No behavior change beyond the fix.** These are security/quality patches; keep diffs surgical.
- Don't bump the app version for this batch unless the owner asks.

---

## AUD-1 — Close the `callType` per-user quota bypass (SEC-2) 🟠

**Verified:** `src/shared/ai/aiPolicy.ts:31-32` — `isInternalCall(callType)` returns `true` for **any** non-null `callType`. `api/chat.ts:501` accepts `callType` from the client (`z.enum(['auto_name','follow_up','query_expand']).nullish()`), `:541-551` sets `isInternalCall`, and when true `checkAndIncrementLimit` is skipped (`:341,347,370,469` only refund `if (!isInternalCall)`). `validateInternalCallRestrictions` (`aiPolicy.ts:37-67`) caps content/tokens but applies **no** counter. So an authenticated user sending `{ callType: 'auto_name' }` on every request never spends their daily quota (only the global cap remains).

**Fix:** give internal calls their **own** cheaper-but-nonzero budget instead of a free pass.
1. In `api/chat.ts`, when `isInternalCall`, call a dedicated counter (e.g. `checkAndIncrementInternalLimit(uid)`) with a separate, more generous daily cap + short cooldown — do NOT skip accounting entirely. Reuse the existing sharded-counter machinery; a separate Firestore field/key so it doesn't touch the chat quota.
2. Keep `validateInternalCallRestrictions` as-is (content/token caps stay).
3. If a simpler path fits: count internal calls against the same per-user daily limit but with a smaller weight, or a fixed higher ceiling. Pick whichever reuses existing counters with the least new code — the invariant is **internal calls are metered, not unlimited per user**.

**Acceptance:** a user spamming `{callType:'auto_name'}` hits a per-user ceiling/cooldown (not just the global cap); normal chat quota unaffected; content restrictions unchanged.

---

## AUD-2 — Run Firestore rules + emulator tests in CI (TEST-1) 🔴

**Verified:** the tests exist and are good (`functions/src/__tests__/rules.test.ts`, ~20 cross-user/role-escalation cases; emulator race tests under `src/__tests__/emulator/`). Scripts exist: `functions/package.json:7-8` (`test:emulator`, `test:rules`) via `firebase emulators:exec`. But CI's only functions step is `ci.yml:69` `cd functions && npm ci && npm run build && npm test` — and `npm test` = `vitest run` with a config that **excludes** rules/emulator. So `firestore.rules` regressions (cross-user read, self-`role:admin`) ship green.

**Fix (CI job — mind the known-broken local firebase-tools):**
1. Add a CI job/step that runs the rules + emulator tests. It needs **Java** (`actions/setup-java`, temurin 17+) and the Firestore emulator.
2. **Use `npx firebase-tools@latest`, not the repo's pinned firebase-tools** — the pinned version is broken locally (`pathRegexp` error). Either invoke `npx -y firebase-tools@latest emulators:exec ...` directly, or override the scripts in the CI step.
3. Make it a **required** check on `main`. Run both `test:rules` and `test:emulator` (the emulator race tests guard the quota-reservation logic).
4. Cache the emulator jar if practical to keep CI time down.

**Acceptance:** a PR that weakens `firestore.rules` (e.g. lets a user read another user's docs, or set their own `role`) fails CI; the rules + emulator suites run on every `main` PR.

---

## AUD-3 — Unify the two prompt sanitizers + parity test (AI-2) 🟠

**Verified:** three copies of the input sanitizer exist — `functions/src/shared/aiUtils.ts` (`sanitizeAiInput`, the Firebase-callable path), `functions/src/shared/buildChatPrompt.ts` (`sanitizeAiInputShared`, the Vercel `/api/chat` path) and a client copy `src/shared/ai/buildChatPrompt.ts`. Per the audit they've **diverged**: `aiUtils` strips `<|im_start|>`/`[INST]`/`<developer>` and caps length ~50K; `sanitizeAiInputShared` strips only `<|system|>/<|user|>/<|assistant|>` and has **no length cap** — so the serverless path sanitizes weaker for identical input.

**Fix:**
1. Make one canonical sanitizer the source of truth (strongest superset: all the control-token patterns + the length cap) and have all three call sites use it. If a shared package isn't feasible across the `functions/` ↔ root boundary, at minimum make the two `buildChatPrompt.ts` copies import/mirror the `aiUtils` implementation and add the length cap to the Vercel path.
2. **Extend the existing parity test** (`promptsParity.test.ts` / `schemaParity.test.ts` already assert byte-identity across backends) to cover the sanitizer: same input → identical output on both paths, including control-token stripping and the length cap.

**Acceptance:** all three sanitizers produce identical output for a shared fixture set (control tokens, oversized input, homoglyphs); a parity test fails if they drift again; the Vercel path now enforces the length cap.

---

## AUD-4 — Admin check in rules via custom claim, not self-read `role` (SEC-3) 🟡

**Verified:** `firestore.rules:28-32` — `isAdmin()` does `get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'`, i.e. reads a **mutable field in the user's own doc**. The only thing preventing self-promotion is `role` being excluded from every write path (`isValidUserUpdate`). Single-layer: any future loosening of the write rule becomes instant privilege escalation. Cloud Functions already use custom claims (`setUserRole`) — rules don't.

**Fix:**
1. Change `isAdmin()` to `request.auth.token.role == 'admin'` (a custom claim the client cannot write). Used at `:140,160,335` (and `:183-187` per audit).
2. **Transition safety:** confirm `setUserRole` sets the custom claim for admins (audit says it does). **Before flipping,** verify existing admin account(s) actually have the claim (claims only apply after token refresh) — otherwise admins lock themselves out. If unsure, ship as `request.auth.token.role == 'admin' || <old self-read>` for one release, then drop the fallback once claims are confirmed live.
3. This must be covered by AUD-2's rules tests (add a case: user with `role:'admin'` in their doc but no claim is NOT admin; user with the claim is).

**Acceptance:** admin access in rules is driven by the custom claim, not the mutable doc field; existing admin(s) still have access (claim verified); a rules test asserts doc-field `role` alone grants nothing.

---

## AUD-5 — Memoize the AI chat message render path (PERF-3) 🟡

**Verified:** `MarkdownRenderer` (`src/features/ai/components/MarkdownRenderer.tsx:27`) and `AssistantTurn` (`AIChatPresentational.tsx:139`) are plain function components (no `memo`). During streaming, `streamingMessage` updates per chunk → every token re-renders `AIPage` and **re-parses markdown for all prior messages** (remark/rehype), not just the active one. (I touched these files this session — confirmed no memo.)

**Fix:**
1. Wrap `AssistantTurn` and `MarkdownRenderer` in `React.memo` with correct prop comparison (content/citation props). Ensure callbacks passed in (`onCitationClick`, etc.) are stable (`useCallback`) so memo actually holds.
2. Do NOT add virtualization here (deferred / larger). Memoization is the cheap win.

**Acceptance:** during a streamed reply, only the active message re-renders/re-parses; prior messages don't re-parse per token (verify via a render count or React Profiler); output identical.

---

## AUD-6 — Delete commented-out dead code (ARCH-9 / ARCH-7) 🟢

**Verified:** ~20 commented-out blocks, mostly in `src/features/ai/`. Includes the reengagement-card block in `AIPage.tsx` we intentionally commented (rather than deleted) earlier — safe to remove now; git history preserves it.

**Fix:**
1. Remove commented-out dead code blocks in `src/features/ai/` (the reengagement card in `AIPage.tsx`; grep for large `//`/`/* */` JSX/logic blocks). Rely on git history, don't keep "just in case" comments.
2. Do **not** touch `ponytail:` intent comments or real explanatory comments — only genuinely dead/commented-out code.
3. Keep it to `src/features/ai/` for this pass (the audit's concentration); a repo-wide sweep can come later.

**Acceptance:** no large commented-out code blocks remain in `src/features/ai/`; `lint:changed` clean; nothing runtime changes.

---

### Note for the owner — everything else is deferred, not dropped
The audit has 2 Critical / 15 High / 24 Medium. We're doing 6. The rest is parked, with reasons:
- **Firebase/Vercel-infra findings** (PERF-2, DEP-5, DEP-2, PERF-9, SEC-1 App-Check default — likely already `true` in prod) → revisit **after** the VPS+Supabase migration decision; don't invest in infra being replaced.
- **Pre-scale perf** (PERF-1, PERF-3-virtualization, PERF-4/5) → invisible at ~1 user; do when there's load.
- **Large refactors** (ARCH-1 AI-module split, ARCH-2 `buildContext` decomposition) → real tech debt, plan later.
- **CI automation** (AUD-2's sibling TEST-2: CodeQL/Dependabot/secret-scan) → worth doing but hygiene, not a live hole.
Full audit lives at the owner's copy (`justwriting-one.md`).
