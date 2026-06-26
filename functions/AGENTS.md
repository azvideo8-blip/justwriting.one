# Functions — Testing Conventions

## Test Types

1. **Unit tests** (`src/**/__tests__/*.test.ts`) — run with `npm test` (vitest, no emulator). Mock Firestore and external services. Fast, CI-default.

2. **Emulator tests** (`src/**/__tests__/emulator/*.emulator.test.ts`) — run with `npm run test:emulator`. Require Firestore emulator (`firebase emulators:exec`). Test real transaction semantics, race conditions, and quota logic.

3. **Rules tests** (`src/**/__tests__/rules.test.ts`) — run with `npm run test:rules`. Require Firestore emulator. Test `firestore.rules` invariants directly.

## Convention: Every AI Endpoint Must Have

- **Happy path**: valid input → correct result, `recordUsage` called.
- **Rate limit**: `checkDailyLimit` returns false → `resource-exhausted`.
- **Provider failure**: AI provider throws → `refundDailyLimit` + `refundGlobalRequest` called, `internal` error thrown.
- **Injection**: disallowed patterns in any user-supplied content → `invalid-argument`.
- **Auth**: no `request.auth` → `unauthenticated`.

## Convention: Transaction-Based Logic Must Have Emulator Tests

Any function that uses `db.runTransaction()` for rate limiting, quota reservation, or atomic updates must have an emulator test that:
- Fires N parallel requests at the boundary
- Verifies the counter never exceeds the limit
- Verifies refund decrements correctly

## Running

```bash
npm test                  # unit tests only (no emulator needed)
npm run test:emulator     # emulator tests (requires firebase CLI)
npm run test:rules        # firestore.rules tests (requires firebase CLI)
```
