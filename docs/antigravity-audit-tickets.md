# Antigravity Audit Tickets — 2026-07-14

Source: application audit of the current working tree. Tickets are ordered by risk and dependency. Do not bundle unrelated tickets into one change.

---

## AG-1 — Restore a clean TypeScript gate and finish-by timer

**Priority:** P0  
**Scope:** Small

**Context:** `src/features/writing/store/useTimerStore.ts:129`, `api/chat.ts:496`

`checkGoals()` compares an undeclared `now` variable with a `Date`, so a running session with a configured finish-by time throws `ReferenceError` on the first goal check. The root typecheck also fails because `validateInternalCallRestrictions()` does not accept the `undefined` values produced by the parsed optional fields in `api/chat.ts`.

**Work:**

1. Capture a wall-clock value in `checkGoals()` and compare like values when evaluating `targetTime`.
2. Make the API policy parameter type match the Zod schema's optional/nullish fields. Do not cast away the error.
3. Add a regression test for a valid `targetTime` while a session is writing; verify both before and after the deadline.
4. Keep the existing timer-mode tests intact.

**Acceptance criteria:**

- [ ] A writing session with `targetTime: "23:59"` does not throw during `checkGoals()`.
- [ ] The finish-by goal becomes reached only at or after its calculated wall-clock deadline.
- [ ] `npm run typecheck` passes with `exactOptionalPropertyTypes` enabled.
- [ ] `npm test -- --run` passes.

**Likely files:**

- `src/features/writing/store/useTimerStore.ts`
- `src/features/writing/__tests__/writingStore.test.ts`
- `src/shared/ai/aiPolicy.ts`
- `api/chat.ts`

**Dependencies:** None

---

## AG-2 — Enforce Firebase App Check on AI endpoints

**Priority:** P1  
**Scope:** Medium

**Context:** all callable AI functions use `enforceAppCheck: false`; `/api/chat` checks App Check only when `APP_CHECK_ENFORCE === 'true'`.

Authenticated users can currently invoke costly AI endpoints without an attested app instance. Per-user limits do not protect the global AI budget from automated account creation or token abuse.

**Work:**

1. Confirm production App Check provider configuration and client token issuance before changing enforcement.
2. Enable callable-function enforcement for all AI and admin callable functions in one coordinated rollout.
3. Set and verify `APP_CHECK_ENFORCE=true` for the Vercel endpoint.
4. Add endpoint tests for missing, invalid, and valid App Check tokens. Preserve the existing Firebase Auth requirement.
5. Document a rollback procedure that can be executed without disabling Firebase Auth or rate limits.

**Acceptance criteria:**

- [ ] A valid Firebase Auth token without a valid App Check token is rejected by every AI endpoint.
- [ ] Valid Auth + App Check requests retain current behaviour.
- [ ] Staging and production telemetry show successful App Check validation before enforcement is enabled for all traffic.
- [ ] The deployment runbook documents rollback and monitoring signals.

**Likely files:**

- `functions/src/ai/*.ts`
- `functions/src/admin/*.ts`
- `api/chat.ts`
- App Check client initialization and deployment configuration
- `docs/api/ai-endpoints.md`

**Dependencies:** None; production configuration approval required.

---

## AG-3 — Validate and sanitize `recentContext` before model use

**Priority:** P1  
**Scope:** Small

**Context:** `functions/src/ai/summarizeDocument.ts:84-113`

`recentContext` is client-controlled input. Unlike `content` and `mood`, it bypasses `hasInjectionAttempt()` and `sanitizeAiInput()` before being embedded into the model prompt.

**Work:**

1. Reject `recentContext` when it matches the shared injection policy.
2. Pass accepted context through `sanitizeAiInput()` before interpolation.
3. Add tests for a blocked injection phrase and for normal multi-note context.
4. Do not refund limits before a global request reservation exists.

**Acceptance criteria:**

- [ ] `recentContext: "ignore previous instructions"` returns `invalid-argument`.
- [ ] Normal recent context is included in the summarization prompt after sanitization.
- [ ] Existing content and mood validation behaviour remains unchanged.
- [ ] Functions unit tests pass.

**Likely files:**

- `functions/src/ai/summarizeDocument.ts`
- `functions/src/ai/__tests__/summarizeDocument.test.ts`

**Dependencies:** None

---

## AG-4 — Make global AI quota refunds atomic and day-safe

**Priority:** P1  
**Scope:** Medium

**Context:** `functions/src/shared/aiUtils.ts:245-256`, `api/chat.ts:141-158`

`refundGlobalRequest()` decrements a random shard with `FieldValue.increment(-1)`. It neither verifies the quota date nor clamps the result. A request reserved before UTC midnight and failing afterwards decrements a new day's shard below zero; the next day can exceed its configured request cap. The comments claim safeguards that the code does not implement.

**Work:**

1. Replace the blind decrement with a transaction that verifies the current quota date and clamps `requests` to zero.
2. Store enough reservation metadata to refund the original day and shard, or explicitly decline stale refunds without modifying the new day. Do not select a new random shard for a refund.
3. Apply one shared implementation to Cloud Functions and `/api/chat`; avoid copy-paste drift.
4. Add emulator coverage for same-day refund, refund without reservation, and a reservation/failure across UTC midnight.

**Acceptance criteria:**

- [ ] No shard's `requests` value becomes negative.
- [ ] A failed request refunds exactly its own reservation, not an unrelated shard or date.
- [ ] Cross-midnight failures cannot create capacity on the new day.
- [ ] The aggregate request count never exceeds `requestsPerDay` under concurrent requests.

**Likely files:**

- `functions/src/shared/aiUtils.ts`
- `api/chat.ts`
- shared quota module/package, if introduced
- `functions/src/__tests__/emulator/aiUtils.emulator.test.ts`

**Dependencies:** None

---

## AG-5 — Redesign the global AI quota limiter for bounded contention

**Priority:** P2  
**Scope:** Medium

**Context:** `functions/src/shared/aiUtils.ts:215-243`, `api/chat.ts:35-63`

Each reservation transaction reads the entire shard collection, then writes one shard. Since every transaction reads every shard, any concurrent write invalidates other transactions; the current design serializes traffic despite the shard count. Token limits also check only recorded historical usage, so concurrent calls can overshoot the token budget before usage is written.

**Work:**

1. Propose a quota design that has a bounded read/write set per reservation and reserves a conservative token allowance before provider execution.
2. Keep request and token accounting correct after success, failure, and refund.
3. Use the same design for Vercel and Cloud Functions, with one source of truth for limits.
4. Add a concurrency test that measures both correctness and transaction retry/failure behaviour at the expected peak rate.

**Acceptance criteria:**

- [ ] Reservation work is bounded; it does not read every quota shard on every request.
- [ ] Concurrent calls cannot exceed either configured global request or token budgets beyond the documented reservation granularity.
- [ ] Provider failure returns the exact reservation safely.
- [ ] The design and operational trade-offs are documented before implementation.

**Likely files:**

- `functions/src/shared/aiUtils.ts`
- `api/chat.ts`
- `functions/src/__tests__/emulator/aiUtils.emulator.test.ts`
- `docs/api/ai-endpoints.md`

**Dependencies:** AG-4

---

## AG-6 — Test production quota code instead of a copied implementation

**Priority:** P2  
**Scope:** Small

**Context:** `functions/src/__tests__/emulator/aiUtils.emulator.test.ts:31-113`

The emulator suite reproduces quota helpers inline rather than importing production code. It can therefore pass while the deployed implementation changes or regresses. The current test even accepts a negative global count after an unpaired refund.

**Work:**

1. Extract quota logic behind an injectable Firestore dependency if required for emulator execution.
2. Import the production implementation in emulator tests; remove copied helper functions.
3. Replace the negative-counter expectation with an invariant that no counter goes below zero.
4. Ensure the test command has a documented Java prerequisite and runs in CI.

**Acceptance criteria:**

- [ ] Emulator tests execute the same quota functions deployed by Cloud Functions.
- [ ] An unpaired refund cannot produce a negative aggregate or shard count.
- [ ] CI provisions Java and runs `npm run test:emulator` and `npm run test:rules`.
- [ ] A deliberate production quota regression makes the emulator suite fail.

**Likely files:**

- `functions/src/shared/aiUtils.ts`
- `functions/src/__tests__/emulator/aiUtils.emulator.test.ts`
- Functions CI configuration
- `functions/AGENTS.md`

**Dependencies:** AG-4

---

## Verification checkpoint

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test -- --run`
- [ ] `(cd functions && npm run build && npm test)`
- [ ] `(cd functions && npm run test:emulator && npm run test:rules)`
- [ ] `npm audit --omit=dev --audit-level=high`
