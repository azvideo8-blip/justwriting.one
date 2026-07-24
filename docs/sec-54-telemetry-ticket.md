# AG-SEC-54-redo — bound telemetry writes without de-anonymising

**Priority:** P3 (Medium-Low) · Scope: Small-Medium
**Files:** `firestore.rules` (`anonymizedTelemetry`), `src/core/services/TelemetryService.ts`, possibly a new callable in `functions/src/`.

## Why this is a redo

The first attempt shipped `allow create: if isAuthenticated() && telemetryId == request.auth.uid && …`. **I reverted it** — it was a regression on two counts:

1. **It rejects 100% of telemetry writes.** The doc id is `getOrCreateTelemetryId()` (`TelemetryService.ts:69`) — a generated pseudonymous id, deliberately **not** the uid. `telemetryId == request.auth.uid` never matches, so every write fails `permission-denied`.
2. **"Fixing" the client to use the uid would de-anonymise the collection.** The whole point of `anonymizedTelemetry` is that rows can't be linked back to an account — that's why it's a separate collection with a random id, and it's the same direction as SEC-27/50 where we hashed the UID before sending it to Langfuse. Keying rows by uid undoes that.

Also note a **pre-existing** quirk: with a stable `telemetryId` and `allow update: false`, only the *first* write per client ever succeeds; later sends already fail silently. Worth deciding on as part of this.

## The actual problem to solve
Any authenticated user can create unbounded docs in `anonymizedTelemetry` with client-chosen ids → write/storage spam. Rules alone can't rate-limit a collection that is intentionally not keyed by user.

## Task — pick one, keep anonymity

**Option A (preferred): rate-limited callable.**
- New callable (`enforceAppCheck: true`) that accepts the telemetry payload, enforces a per-uid rate limit server-side (reuse the existing daily/cooldown helpers in `functions/src/shared/aiUtils.ts`), and writes the doc **without storing the uid** — the stored row keeps only the anonymous `telemetryId`.
- Tighten rules to `allow create: if false` for clients (admin/service writes only).
- Result: bounded writes, anonymity preserved (uid used only transiently for the rate check, never persisted).

**Option B (cheap mitigation, keeps client write):**
- Keep the anonymous id, but allow the client to overwrite its own single row: `allow create, update: if isAuthenticated() && isValidTelemetry(...)`. Bounds an honest client to one doc and fixes the "only first send works" quirk.
- Residual: a malicious client can still mint new ids. Document that as accepted risk if chosen.

**Do NOT** bind `telemetryId` to `request.auth.uid` (see above).

## Acceptance
- [ ] Telemetry writes succeed again (regression from the first attempt is gone).
- [ ] Stored rows contain **no uid** — anonymity of the collection preserved.
- [ ] Unbounded per-user doc creation is bounded (server-side limit for Option A, or documented accepted risk for Option B).
- [ ] Emulator rules test covers: authed write allowed/denied per the chosen design (unit suite does NOT cover `firestore.rules` — run the emulator test).
- [ ] `tsc` 0; full vitest suite green; lint on changed files.

**Note:** `firestore.rules` is only exercised by the emulator test suite, not the normal `vitest` run — a green 707/707 says nothing about rules. Run the emulator test for this ticket.
